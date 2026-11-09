import {SidePlankAnalyzer} from '../runtime/index.js';
const analyzer=new SidePlankAnalyzer();
// Camera callbacks: analyzer.pushFrame({timestampMs,width,height,landmarks});
// Pause / camera interruption: analyzer.breakContinuity('pause');
console.log(JSON.stringify(analyzer.finish()[0],null,2));
