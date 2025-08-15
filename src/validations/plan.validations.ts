import {PLAN_CONFIGS, PlanConfig, PRICE_ID_TO_PLAN} from "../constants/pricingPlans.constant";

interface ValidatedPlan {
    planConfig: PlanConfig;
    billingCycle: 'monthly' | 'yearly';
}

export class PlanValidator {
    static validatePriceId(priceId: string): ValidatedPlan | null {
        const planConfig = PRICE_ID_TO_PLAN.get(priceId);

        if (!planConfig) {
            return null;
        }

        const billingCycle = priceId === planConfig.priceIds.monthly ? 'monthly' : 'yearly';

        return {
            planConfig,
            billingCycle
        };
    }

    // static getPlanConfig(planName: string): ValidatedPlan | null {
    //     const planConfig = PLAN_CONFIGS.find((plan)=>plan.dbPlanType === planName);
    //
    //     if(!planConfig) {
    //         return null;
    //     }
    //
    //     const billingCycle = planConfig
    // }

    static getValidPriceIds(): string[] {
        return Array.from(PRICE_ID_TO_PLAN.keys()).filter(priceId => {
            const plan = PRICE_ID_TO_PLAN.get(priceId);
            return plan && !plan.isFree;
        });
    }
}
