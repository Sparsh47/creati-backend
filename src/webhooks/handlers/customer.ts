import {prismaClient} from "../../services/prisma.service";

export const handleCustomerUpdated = async (customer: any) => {
    console.log("Processing customer updated: ", customer.id);

    await prismaClient.user.updateMany({
        where: {
            stripeCustomerId: customer.id
        },
        data: {
            email: customer.email
        }
    })
}

export const handleCustomerDeleted = async (customer: any) => {
    console.log("Processing customer deleted: ", customer.id);

    await prismaClient.user.deleteMany({
        where: {
            stripeCustomerId: customer.id
        }
    })
}