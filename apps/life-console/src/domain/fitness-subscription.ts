export interface FitnessSubscriptionState {enabled:boolean;includeNotes:boolean;revision:number}
export interface FitnessSubscriptionChange {expectedRevision:number;includeNotes:boolean}
export interface FitnessSubscriptionPort {
 get():Promise<FitnessSubscriptionState>;
 rotate(input:FitnessSubscriptionChange):Promise<FitnessSubscriptionState & {url:string}>;
 update(input:FitnessSubscriptionChange & {enabled:boolean}):Promise<FitnessSubscriptionState>;
}
