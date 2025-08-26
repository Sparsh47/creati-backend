import {Request, Response} from 'express';
import {ApplicationError} from "../lib/utils";
import {prismaClient} from "../services/prisma.service";
import neo4jDriver from "../services/neo4j.service";
import cloudinary from "../services/cloudinary.service";
import {UploadApiResponse, UploadApiErrorResponse} from "cloudinary";
import {PlanValidator} from "../validations/plan.validations";
import {Type} from "../generated/prisma";

interface CloudinaryResult {
    public_id: string;
    url: string;
    secure_url: string;
    format: string;
    width: number;
    height: number;
    bytes: number;
}

export default class DesignsController {
    private static _instance: DesignsController;

    private constructor() {
    }

    public static getInstance() {
        if (!DesignsController._instance) {
            DesignsController._instance = new DesignsController();
        }
        return this._instance;
    }

    async getAllDesigns(req: Request, res: Response) {
        try {
            const designs = await prismaClient.designs.findMany({
                where: {
                    visibility: "PUBLIC"
                },
                include: {
                    images: true,
                    users: true
                }
            });

            res.status(200).json({
                status: true, data: designs
            })
        } catch (e) {
            ApplicationError(e);
        }
    }

    async getDesign(req: Request, res: Response) {
        try {
            const { designId } = req.params;

            if (!designId) {
                return res.status(400).json({
                    success: false,
                    message: "Design ID is required"
                });
            }

            const session = neo4jDriver.session();

            try {
                const design = await prismaClient.designs.findUnique({
                    where: {
                        id: designId
                    }
                })

                const result = await session.executeRead(async (transaction) => {
                    const nodeResult = await transaction.run(`
                    MATCH (n:Node {designId: $designId})
                    RETURN n
                    ORDER BY n.createdAt
                `, { designId });

                    const edgeResult = await transaction.run(`
                    MATCH (e:Edge {designId: $designId})
                    RETURN e
                    ORDER BY e.createdAt
                `, { designId });

                    return {
                        nodes: nodeResult.records,
                        edges: edgeResult.records
                    };
                });

                const nodes = result.nodes.map(record => {
                    const node = record.get('n').properties;

                    const reactFlowNode: any = {
                        id: node.originalId,
                        type: node.type,
                        position: JSON.parse(node.position || '{}'),
                        data: JSON.parse(node.data || '{}'),
                    };

                    if (node.style && node.style !== '{}') {
                        reactFlowNode.style = JSON.parse(node.style);
                    }
                    if (node.className) {
                        reactFlowNode.className = node.className;
                    }
                    if (node.hidden === true) {
                        reactFlowNode.hidden = node.hidden;
                    }
                    if (node.selected === true) {
                        reactFlowNode.selected = node.selected;
                    }
                    if (node.dragging === true) {
                        reactFlowNode.dragging = node.dragging;
                    }
                    if (node.width) {
                        reactFlowNode.width = node.width;
                    }
                    if (node.height) {
                        reactFlowNode.height = node.height;
                    }
                    if (node.zIndex) {
                        reactFlowNode.zIndex = node.zIndex;
                    }

                    return reactFlowNode;
                });

                const edges = result.edges.map(record => {
                    const edge = record.get('e').properties;

                    const reactFlowEdge: any = {
                        id: edge.originalId,
                        source: edge.originalSource,
                        target: edge.originalTarget,
                    };

                    if (edge.type) {
                        reactFlowEdge.type = edge.type;
                    }
                    if (edge.label) {
                        reactFlowEdge.label = edge.label;
                    }
                    if (edge.sourceHandle) {
                        reactFlowEdge.sourceHandle = edge.sourceHandle;
                    }
                    if (edge.targetHandle) {
                        reactFlowEdge.targetHandle = edge.targetHandle;
                    }
                    if (edge.style && edge.style !== '{}') {
                        reactFlowEdge.style = JSON.parse(edge.style);
                    }
                    if (edge.markerEnd && edge.markerEnd !== '{}') {
                        reactFlowEdge.markerEnd = JSON.parse(edge.markerEnd);
                    }
                    if (edge.markerStart && edge.markerStart !== '{}') {
                        reactFlowEdge.markerStart = JSON.parse(edge.markerStart);
                    }
                    if (edge.animated === true) {
                        reactFlowEdge.animated = edge.animated;
                    }
                    if (edge.hidden === true) {
                        reactFlowEdge.hidden = edge.hidden;
                    }
                    if (edge.selected === true) {
                        reactFlowEdge.selected = edge.selected;
                    }
                    if (edge.data && edge.data !== '{}') {
                        reactFlowEdge.data = JSON.parse(edge.data);
                    }
                    if (edge.zIndex) {
                        reactFlowEdge.zIndex = edge.zIndex;
                    }

                    return reactFlowEdge;
                });

                res.status(200).json({
                    success: true,
                    design: {
                        ...design,
                        nodes,
                        edges
                    },
                    nodeCount: nodes.length,
                    edgeCount: edges.length
                });

            } finally {
                await session.close();
            }

        } catch (e: any) {
            console.error('Error retrieving design data:', e);
            res.status(500).json({
                success: false,
                message: 'Failed to retrieve design data',
                error: e.message
            });
        }
    }

    async createDesign(req: Request, res: Response) {
        try {
            const {nodes, edges, prompt, email} = req.body;
            if (!nodes || !edges || !prompt || !email) {
                res.status(400).json({
                    status: false,
                    message: "Prompt, nodes, edges, email are missing"
                });
                return;
            }

            const user = await prismaClient.user.findFirst({where: {email}, include: {designs: true}});

            if (!user) {
                res.status(404).json({
                    status: false,
                    message: "User not found."
                });
                return;
            }

            const totalDesigns = user.designs.length;

            if(totalDesigns === user.maxDesigns) {
                res.status(429).json({
                    status: false,
                    error: "Upgrade your subscription to create more designs."
                });
                return;
            }

            const design = await prismaClient.designs.create({
                data: {
                    prompt,
                    title: `Untitled Design ${totalDesigns + 1}`,
                    users: {
                        connect: [{id: user.id}]
                    }
                }
            });

            const session = neo4jDriver.session();

            try {
                await session.executeWrite(async (transaction) => {
                    if (nodes.length > 0) {
                        const nodesWithMeta = nodes.map((node: any) => ({
                            id: `${design.id}-${node.id}`,
                            originalId: node.id,
                            type: node.type,
                            position: JSON.stringify(node.position || {}),
                            data: JSON.stringify(node.data || {}),
                            style: JSON.stringify(node.style || {}),
                            className: node.className || '',
                            hidden: node.hidden || false,
                            selected: node.selected || false,
                            dragging: node.dragging || false,
                            width: node.width || null,
                            height: node.height || null,
                            zIndex: node.zIndex || null,
                            userId: user.id,
                            designId: design.id,
                            createdAt: new Date().toISOString(),
                        }));

                        await transaction.run(`
                        UNWIND $nodes as nodeData
                        CREATE (n:Node)
                        SET n = nodeData
                    `, {nodes: nodesWithMeta});
                        console.log(`✅ Created ${nodes.length} nodes in Neo4j`);
                    }

                    if (edges.length > 0) {
                        const edgesWithMeta = edges.map((edge: any) => ({
                            id: `${design.id}-${edge.id}`,
                            originalId: edge.id,
                            source: `${design.id}-${edge.source}`,
                            target: `${design.id}-${edge.target}`,
                            originalSource: edge.source,
                            originalTarget: edge.target,
                            label: edge.label || '',
                            type: edge.type || '',
                            sourceHandle: edge.sourceHandle || '',
                            targetHandle: edge.targetHandle || '',
                            style: JSON.stringify(edge.style || {}),
                            markerEnd: JSON.stringify(edge.markerEnd || {}),
                            markerStart: JSON.stringify(edge.markerStart || {}),
                            animated: edge.animated || false,
                            hidden: edge.hidden || false,
                            selected: edge.selected || false,
                            data: JSON.stringify(edge.data || {}),
                            zIndex: edge.zIndex || null,
                            userId: user.id,
                            designId: design.id,
                            createdAt: new Date().toISOString(),
                        }));

                        console.log("Edges with meta: ", edgesWithMeta);

                        await transaction.run(`
                        UNWIND $edges as edgeData
                        CREATE (e:Edge)
                        SET e = edgeData
                    `, {edges: edgesWithMeta});
                        console.log(`✅ Created ${edges.length} edges in Neo4j`);

                        await transaction.run(`
                        UNWIND $edges as edgeData
                        MATCH (source:Node {id: edgeData.source, designId: edgeData.designId})
                        MATCH (target:Node {id: edgeData.target, designId: edgeData.designId})
                        CREATE (source)-[:CONNECTS_TO {
                            edgeId: edgeData.id, 
                            label: edgeData.label,
                            originalEdgeId: edgeData.originalId
                        }]->(target)
                    `, {edges: edgesWithMeta});
                        console.log(`✅ Created ${edges.length} relationships`);
                    }
                });

                res.status(201).json({
                    success: true,
                    message: 'Design created successfully',
                    design: design,
                    nodeCount: nodes.length,
                    edgeCount: edges.length
                });

            } catch (e: any) {
                console.error('Neo4j Error:', e);
                res.status(500).json({
                    success: false,
                    message: 'Failed to save to Neo4j',
                    error: e.message
                });
            } finally {
                await session.close();
            }

        } catch (e) {
            ApplicationError(e);
        }
    }

    async uploadImage(req: Request, res: Response) {
        try {

            const {designId, userId} = req.params;

            const user = await prismaClient.user.findUnique({where: {id: userId}});

            if (!user) {
                res.status(401).json({
                    success: false,
                    message: 'User not found',
                });
                return;
            }

            const design = await prismaClient.designs.findFirst({where: {id: designId, users: { some: {id: userId}}}});

            if (!design) {
                res.status(404).json({
                    success: false,
                    message: 'Design not found',
                });
                return;
            }

            if(!req.file) {
                res.status(400).json({
                    status: false,
                    message: 'No files uploaded',
                });
                return;
            }

            const result: UploadApiResponse = await new Promise((resolve, reject) => {
                cloudinary.uploader.upload_stream({
                    resource_type: 'image',
                    folder: `designs/${designId}`,
                    public_id: `${Date.now()}-${req.file?.originalname.split('.')[0]}`,
                    transformation: [
                        {
                            width: 2000,
                            height: 2000,
                            crop: 'limit'
                        },
                        {
                            quality: 'auto'
                        },
                        {
                            format: 'auto'
                        }
                    ]
                },
                    (error: UploadApiErrorResponse | undefined, result: UploadApiResponse | undefined) => {
                        if (error) {
                            reject(error);
                        } else if (result) {
                            resolve(result);
                        } else {
                            reject(new Error('Upload failed: No result returned'));
                        }
                    }).end(req.file?.buffer);
            });

            const savedImage = await prismaClient.images.create({
                data: {
                    publicId: result.public_id,
                    url: result.url,
                    secureUrl: result.secure_url,
                    originalName: req.file?.originalname!,
                    format: result.format,
                    width: result.width,
                    height: result.height,
                    size: result.bytes,
                    designsId: designId
                }
            });

            res.json({
                status: true,
                message: 'Image added to design successfully',
                data: savedImage
            });

        } catch (e) {
            ApplicationError(e);
        }
    }

    async getDesignByUser(req: Request, res: Response) {
        try {
            const userId = req.user?.userId;

            const user = await prismaClient.user.findUnique({
                where: {
                    id: userId
                },
                include: {
                    subscriptions: {
                        orderBy: {
                            updatedAt: "desc"
                        },
                        select: {
                            stripePriceId: true
                        },
                        take: 1
                    }
                }
            });

            if(!user) {
                res.status(404).json({
                    status: false,
                    message: 'User not found'
                })
                return;
            }

            const latestPlanStripePriceId = user.subscriptions[0].stripePriceId;

            let maxDesignCount: number = 3;

            if(latestPlanStripePriceId) {
                const latestPlanDetails = PlanValidator.validatePriceId(latestPlanStripePriceId);
                if(latestPlanDetails) {
                    maxDesignCount = latestPlanDetails.planConfig.maxDesigns;
                } else {
                    maxDesignCount = 3;
                }
            }

            const userDesigns = await prismaClient.designs.findMany({
                where: {
                    users: {
                        some: {
                            id: userId
                        }
                    }
                },
                include: {
                    images: true,
                    users: true
                },
                orderBy: {
                    createdAt: "desc"
                },
                ...(maxDesignCount !== -1 && { take: maxDesignCount }),
            });

            res.status(200).json({
                status: true,
                data: userDesigns,
            })

        } catch (e) {
            ApplicationError(e);
        }
    }

    async deleteDesignById(req: Request, res: Response) {
        try {
            const {designId} = req.params;

            const design = await prismaClient.designs.findFirst({where: {id: designId}});

            if(!design) {
                res.status(404).json({
                    status: false,
                    message: "Design not found"
                })
            }

            await prismaClient.designs.delete({where: {id: designId}});

            res.status(200).json({
                status: true,
                message: 'Design deleted successfully'
            })

        } catch (e) {
            ApplicationError(e);
        }
    }

    async updateDesignData(req: Request, res: Response) {
        try {
            const {designId} = req.params;
            const {title, visibility} = req.body;

            const design = await prismaClient.designs.findUnique({
                where: {
                    id: designId
                }
            });

            if(!design) {
                return res.status(404).json({
                    status: false,
                    message: "Design not found"
                })
            }

            if(title && title.trim().length > 0 && title !== design.title) {
                await prismaClient.designs.update({
                    where:{
                        id: designId
                    },
                    data: {
                        title: title
                    }
                })
            }

            if(visibility && visibility !== (design.visibility as string)) {
                await prismaClient.designs.update({
                    where:{
                        id: designId
                    },
                    data: {
                        visibility: visibility === "PUBLIC" ? Type.PUBLIC : Type.PRIVATE
                    }
                })
            }

            return res.status(200).json({
                status: true,
                message: 'Design updated successfully',
                data: {
                    design
                }
            })
        } catch (e) {
            ApplicationError(e);
        }
    }

    async addDesignToUser(req: Request, res: Response) {
        try {
            const { designId } = req.body;
            const userId = req.user?.userId;

            const user = await prismaClient.user.findUnique({
                where: { id: userId },
                include: { designs: true }
            });

            if (!user) {
                return res.status(404).json({
                    status: false,
                    message: "User not found"
                });
            }

            const alreadyOwned = await prismaClient.designs.findFirst({
                where: {
                    id: designId,
                    users: {
                        some: { id: userId }
                    }
                }
            });

            if (alreadyOwned) {
                return res.status(409).json({
                    status: false,
                    message: "You already have this design in your account"
                });
            }

            const totalDesigns = user.designs.length;
            if (totalDesigns >= user.maxDesigns) {
                return res.status(429).json({
                    status: false,
                    error: "Upgrade your subscription to create more designs."
                });
            }

            const existingDesign = await prismaClient.designs.findUnique({
                where: { id: designId },
                include: { images: true }
            });

            if (!existingDesign) {
                return res.status(404).json({
                    status: false,
                    message: "Design not found"
                });
            }

            const { id, createdAt, images, ...rest } = existingDesign;

            const newDesign = await prismaClient.designs.create({
                data: {
                    ...rest,
                    title: `${existingDesign.title} (Copy)`,
                    visibility: Type.PRIVATE,
                    users: {
                        connect: { id: userId }
                    },
                    images: {
                        create: images.map(img => ({
                            publicId: `${img.publicId}-${Date.now()}`,
                            url: img.url,
                            secureUrl: img.secureUrl,
                            originalName: img.originalName,
                            format: img.format,
                            width: img.width,
                            height: img.height,
                            size: img.size
                        }))
                    }
                },
                include: { images: true, users: true }
            });

            const session = neo4jDriver.session();
            try {
                const result = await session.executeRead(async (transaction) => {
                    const nodesResult = await transaction.run(`
                  MATCH (n:Node {designId: $designId})
                  RETURN n
                  ORDER BY n.createdAt
                `, { designId });

                    const edgesResult = await transaction.run(`
                  MATCH (e:Edge {designId: $designId})
                  RETURN e
                  ORDER BY e.createdAt
                `, { designId });

                    return {
                        nodes: nodesResult.records.map(r => r.get('n').properties),
                        edges: edgesResult.records.map(r => r.get('e').properties)
                    };
                });

                const oldToNewNodeId: Record<string, {id: string, originalId: string}> = {};
                const nodesWithMeta = result.nodes.map((node: any) => {
                    const newOriginalId = node.originalId;
                    const newId = `${newDesign.id}-${node.originalId}`;
                    oldToNewNodeId[node.originalId] = { id: newId, originalId: newOriginalId };
                    return {
                        id: newId,
                        originalId: newOriginalId,
                        type: node.type,
                        position: node.position,
                        data: node.data,
                        style: node.style || '{}',
                        className: node.className || '',
                        hidden: node.hidden || false,
                        selected: node.selected || false,
                        dragging: node.dragging || false,
                        width: node.width || null,
                        height: node.height || null,
                        zIndex: node.zIndex || null,
                        userId,
                        designId: newDesign.id,
                        createdAt: new Date().toISOString(),
                    };
                });

                const edgesWithMeta = result.edges.map((edge: any) => {
                    return {
                        id: `${newDesign.id}-${edge.originalId}`,
                        originalId: edge.originalId,
                        source: oldToNewNodeId[edge.originalSource]?.id || `${newDesign.id}-${edge.originalSource}`,
                        target: oldToNewNodeId[edge.originalTarget]?.id || `${newDesign.id}-${edge.originalTarget}`,
                        originalSource: edge.originalSource,
                        originalTarget: edge.originalTarget,
                        label: edge.label || '',
                        type: edge.type || '',
                        sourceHandle: edge.sourceHandle || '',
                        targetHandle: edge.targetHandle || '',
                        style: edge.style || '{}',
                        markerEnd: edge.markerEnd || '{}',
                        markerStart: edge.markerStart || '{}',
                        animated: edge.animated || false,
                        hidden: edge.hidden || false,
                        selected: edge.selected || false,
                        data: edge.data || '{}',
                        zIndex: edge.zIndex || null,
                        userId,
                        designId: newDesign.id,
                        createdAt: new Date().toISOString(),
                    };
                });

                await session.executeWrite(async (transaction) => {
                    if (nodesWithMeta.length > 0) {
                        await transaction.run(`
                        UNWIND $nodes as nodeData
                        CREATE (n:Node)
                        SET n = nodeData
                    `, { nodes: nodesWithMeta });
                    }
                    if (edgesWithMeta.length > 0) {
                        await transaction.run(`
                        UNWIND $edges as edgeData
                        CREATE (e:Edge)
                        SET e = edgeData
                    `, { edges: edgesWithMeta });

                        await transaction.run(`
                        UNWIND $edges as edgeData
                        MATCH (source:Node {id: edgeData.source, designId: edgeData.designId})
                        MATCH (target:Node {id: edgeData.target, designId: edgeData.designId})
                        CREATE (source)-[:CONNECTS_TO {
                            edgeId: edgeData.id, 
                            label: edgeData.label,
                            originalEdgeId: edgeData.originalId
                        }]->(target)
                    `, { edges: edgesWithMeta });
                    }
                });
            } finally {
                await session.close();
            }

            return res.status(201).json({
                status: true,
                message: "Design duplicated successfully (nodes and edges copied)",
                data: newDesign
            });

        } catch (e) {
            ApplicationError(e);
        }
    }

    // ───────────────────────────────────────────────────────────────────────────
// Atomic delete-and-recreate of a design in Neo4j, returning React-Flow data
// ───────────────────────────────────────────────────────────────────────────
    async saveDesign(req: Request, res: Response) {
        try {
            const { designId } = req.params;
            const userId = req.user?.userId;
            const { nodes, edges } = req.body;

            /* ─── basic validation ──────────────────────────────────────────────── */
            if (!designId || !userId)
                return res.status(400).json({ status: false, message: "Design ID and user ID are required" });

            if (!Array.isArray(nodes) || !Array.isArray(edges))
                return res.status(400).json({ status: false, message: "Nodes and edges must be arrays" });

            /* ─── verify ownership ─────────────────────────────────────────────── */
            const design = await prismaClient.designs.findUnique({
                where: { id: designId, users: { some: { id: userId } } }
            });
            if (!design)
                return res.status(404).json({ status: false, message: "Design not found or access denied" });

            /* ─── build payloads once ───────────────────────────────────────────── */
            const nowISO = new Date().toISOString();

            const nodesWithMeta = nodes.map((n: any) => ({
                id: `${designId}-${n.id}`,
                originalId: n.id,
                type: n.type,
                position: JSON.stringify(n.position ?? {}),
                data: JSON.stringify(n.data ?? {}),
                style: JSON.stringify(n.style ?? {}),
                className: n.className ?? "",
                hidden: !!n.hidden,
                selected: !!n.selected,
                dragging: !!n.dragging,
                width: n.width ?? null,
                height: n.height ?? null,
                zIndex: n.zIndex ?? null,
                userId,
                designId,
                createdAt: nowISO
            }));

            const edgesWithMeta = edges.map((e: any) => ({
                id: `${designId}-${e.id}`,
                originalId: e.id,
                source: `${designId}-${e.source}`,
                target: `${designId}-${e.target}`,
                originalSource: e.source,
                originalTarget: e.target,
                label: e.label ?? "",
                type: e.type ?? "",
                sourceHandle: e.sourceHandle ?? "",
                targetHandle: e.targetHandle ?? "",
                style: JSON.stringify(e.style ?? {}),
                markerEnd: JSON.stringify(e.markerEnd ?? {}),
                markerStart: JSON.stringify(e.markerStart ?? {}),
                animated: !!e.animated,
                hidden: !!e.hidden,
                selected: !!e.selected,
                data: JSON.stringify(e.data ?? {}),
                zIndex: e.zIndex ?? null,
                userId,
                designId,
                createdAt: nowISO
            }));

            const edgeIds = edgesWithMeta.map(e => e.id);
            const session = neo4jDriver.session();

            /* ─── Neo4j atomic operations ──────────────────────────────────────── */
            try {
                await session.executeWrite(async tx => {
                    /* 1️⃣ delete existing nodes for the design (DETACH removes rels)   */
                    await tx.run(
                        `MATCH (n:Node {designId:$designId}) DETACH DELETE n`,
                        { designId }
                    );

                    /* 2️⃣ delete the specific edges we will recreate (by unique id)    */
                    if (edgeIds.length) {
                        await tx.run(
                            `MATCH (e:Edge) WHERE e.id IN $edgeIds DETACH DELETE e`,
                            { edgeIds }
                        );
                    }

                    /* 3️⃣ create new nodes                                             */
                    if (nodesWithMeta.length) {
                        await tx.run(
                            `
            UNWIND $nodes AS nData
            CREATE (n:Node) SET n = nData
            `,
                            { nodes: nodesWithMeta }
                        );
                    }

                    /* 4️⃣ create new edges                                             */
                    if (edgesWithMeta.length) {
                        await tx.run(
                            `
            UNWIND $edges AS eData
            CREATE (e:Edge) SET e = eData
            `,
                            { edges: edgesWithMeta }
                        );

                        /* 5️⃣ relationships between the new nodes                       */
                        await tx.run(
                            `
            UNWIND $edges AS eData
            MATCH (s:Node {id:eData.source, designId:$designId})
            MATCH (t:Node {id:eData.target, designId:$designId})
            CREATE (s)-[:CONNECTS_TO {
              edgeId:eData.id, label:eData.label, originalEdgeId:eData.originalId
            }]->(t)
            `,
                            { designId, edges: edgesWithMeta }
                        );
                    }
                });

                /* ─── read back & transform to React-Flow ────────────────────────── */
                const fresh = await session.executeRead(async tx => {
                    const [nRes, eRes] = await Promise.all([
                        tx.run(`MATCH (n:Node {designId:$designId}) RETURN n ORDER BY n.createdAt`, { designId }),
                        tx.run(`MATCH (e:Edge {designId:$designId}) RETURN e ORDER BY e.createdAt`, { designId })
                    ]);
                    return { n: nRes.records, e: eRes.records };
                });

                const reactNodes = fresh.n.map(r => {
                    const n = r.get("n").properties;
                    return {
                        id: n.originalId,
                        type: n.type,
                        position: JSON.parse(n.position || "{}"),
                        data: JSON.parse(n.data || "{}"),
                        ...(n.style && n.style !== "{}" && { style: JSON.parse(n.style) }),
                        ...(n.className && { className: n.className }),
                        ...(n.hidden && { hidden: true }),
                        ...(n.selected && { selected: true }),
                        ...(n.dragging && { dragging: true }),
                        ...(n.width && { width: Number(n.width) }),
                        ...(n.height && { height: Number(n.height) }),
                        ...(n.zIndex && { zIndex: Number(n.zIndex) })
                    };
                });

                const reactEdges = fresh.e.map(r => {
                    const e = r.get("e").properties;
                    return {
                        id: e.originalId,
                        source: e.originalSource,
                        target: e.originalTarget,
                        ...(e.type && { type: e.type }),
                        ...(e.label && { label: e.label }),
                        ...(e.sourceHandle && { sourceHandle: e.sourceHandle }),
                        ...(e.targetHandle && { targetHandle: e.targetHandle }),
                        ...(e.style && e.style !== "{}" && { style: JSON.parse(e.style) }),
                        ...(e.markerEnd && e.markerEnd !== "{}" && { markerEnd: JSON.parse(e.markerEnd) }),
                        ...(e.markerStart && e.markerStart !== "{}" && { markerStart: JSON.parse(e.markerStart) }),
                        ...(e.animated && { animated: true }),
                        ...(e.hidden && { hidden: true }),
                        ...(e.selected && { selected: true }),
                        ...(e.data && e.data !== "{}" && { data: JSON.parse(e.data) }),
                        ...(e.zIndex && { zIndex: Number(e.zIndex) })
                    };
                });

                return res.status(200).json({
                    success: true,
                    message: "Design saved and updated successfully",
                    design: {
                        id: designId,
                        nodeCount: reactNodes.length,
                        edgeCount: reactEdges.length
                    },
                    nodes: reactNodes,
                    edges: reactEdges
                });
            } catch (err: any) {
                console.error("Neo4j error:", err);
                return res.status(500).json({
                    success: false,
                    message: "Failed to save to Neo4j",
                    error: err.message
                });
            } finally {
                await session.close();
            }
        } catch (err) {
            console.error("saveDesign error:", err);
            ApplicationError(err);
        }
    }
}