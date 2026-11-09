// Shared valid-hold accounting. Exercise-specific geometry remains in each engine.
export const VALID_HOLD_CONFIG=Object.freeze({confirmationSeconds:.3,maxGapSeconds:.25});
export function validHoldInterval({previousTime,time,previousEligible,eligible,continuous=true,maxGapSeconds=VALID_HOLD_CONFIG.maxGapSeconds}){
 if(!continuous||!previousEligible||!eligible||!Number.isFinite(previousTime)||!Number.isFinite(time))return 0;
 const dt=time-previousTime;
 return dt>0&&dt<=maxGapSeconds?dt:0;
}
