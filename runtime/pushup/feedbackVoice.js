// Display updates never directly queue speech. Reconsider only fresh tracked results.
export const VOICE_PRIORITY = ['HIP_DROP','HIP_RAISE','ELBOW_SHALLOW','CHEST_RANGE_LOW','RETURN_INCOMPLETE','HAND_TOWARD_HEAD','HAND_TOWARD_HIP'];
export const VOICE_TEXT = {ELBOW_SHALLOW:'내려가는 깊이와 팔꿈치 벌어짐을 확인해 주세요.'};
export class FeedbackVoice {
  constructor({sameMs=10000, gapMs=6000, now=()=>Date.now()}={}) {
    this.sameMs=sameMs;this.gapMs=gapMs;this.now=now;this.last=new Map();this.lastAny=-Infinity;this.pending=false;this.generation=0;
  }
  cancel(){this.generation++;}
  async update(result, enabled, speakIfIdle, texts) {
    if(!enabled||result.tracking!=='tracking'||this.pending||!speakIfIdle)return null;
    const now=this.now();if(now-this.lastAny<this.gapMs)return null;
    const code=VOICE_PRIORITY.find(c=>result.codes?.includes(c)&&now-(this.last.get(c)??-Infinity)>=this.sameMs);
    if(!code)return null;
    const generation=this.generation;this.pending=true;
    try {
      const accepted=await speakIfIdle(VOICE_TEXT[code]??texts[code]);
      if(!accepted||generation!==this.generation)return null;
      this.last.set(code,this.now());this.lastAny=this.now();return code;
    } finally {this.pending=false;}
  }
}
