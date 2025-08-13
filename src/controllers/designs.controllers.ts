import {Request, Response} from 'express';
import {ApplicationError} from "../lib/utils";
import {prismaClient} from "../services/prisma.service";
import neo4jDriver from "../services/neo4j.service";
import cloudinary from "../services/cloudinary.service";
import {UploadApiResponse, UploadApiErrorResponse} from "cloudinary";

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
                        id: node.originalId,                    // Original React Flow ID
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
                    nodes,
                    edges,
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
            const {userId} = req.params;

            const user = await prismaClient.user.findUnique({where: {id: userId}});

            if(!user) {
                res.status(404).json({
                    status: false,
                    message: 'User not found'
                })
                return;
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
                }
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
}