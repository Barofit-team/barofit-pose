import {MountainClimberAnalyzer} from './analyzer.js';

// Review build: keep set.items at the validated hip-only contract. A knee observation
// concerns two adjacent same-side excursions, not one counted exercise repetition.
const cutoff=0.1452224818924854;
const empty=()=>({low:null,peak:null,previous:null,last:null});
export class MountainClimberReviewAnalyzer extends MountainClimberAnalyzer {
  constructor(){super();this.monitors=[empty(),empty()];this.pairs=[];}
  breakContinuity(reason){this.monitors=[empty(),empty()];return super.breakContinuity(reason);}
  sample(frame,side,index,m){
    const t=frame.timestampMs;
    if(!m || (this.monitors[index].last!==null && t-this.monitors[index].last>220))this.monitors[index]=empty();
    const state=this.monitors[index];state.last=t;if(!m)return null;
    const v=m.kneeForward;
    if(v>-.12){
      if(state.low!==null && v>-.08 && (!state.peak || v>state.peak.v)){
        const [s,h,k]=[11,23,25].map(i=>frame.landmarks[i+index]);
        const dx=(s[0]-h[0])*frame.width, dy=(s[1]-h[1])*frame.height;
        state.peak={v,t,horizontal:Math.sign(dx)*(k[0]-h[0])*frame.width/Math.hypot(dx,dy)};
      }
      return null;
    }
    let pair=null;
    if(state.peak && state.peak.v-state.low>=.15){
      const p=state.peak,prev=state.previous;
      if(prev && p.t-prev.t>=350 && p.t-prev.t<=1600){
        const axial=Math.max(prev.v,p.v),horizontal=Math.max(prev.horizontal,p.horizontal);
        pair={timestampMs:t,side,axial,horizontal,short:axial<cutoff && horizontal<cutoff};
        this.pairs.push(pair);
      }
      state.previous=p;
    }
    state.low=state.peak||state.low===null?v:Math.min(state.low,v);state.peak=null;return pair;
  }
  pushFrame(frame){
    const r=super.pushFrame(frame);if(r.ignored)return r;
    for(const [j,side] of ['left','right'].entries()){
      const pair=this.sample(frame,side,j,r.metrics[side]);
      if(pair)r.events.push({type:'review.knee_pair',...pair});
    }
    return r;
  }
  summary(){const s=super.summary();s.details.kneeReachReview={cutoff,unit:'same_side_adjacent_pair',evaluated:this.pairs.length,
    short:this.pairs.filter(p=>p.short).length,pairs:this.pairs.map(p=>({...p}))};return s;}
}
