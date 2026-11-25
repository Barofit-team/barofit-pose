// Replay local MediaPipe frames without uploading video or coordinates.
import fs from 'node:fs';
import * as pose from '../runtime/index.js';
const classes={jump_squat:pose.JumpSquatAnalyzer,reverse_crunch:pose.ReverseCrunchAnalyzer,
  flutter_kicks:pose.FlutterKicksAnalyzer,burpee:pose.BurpeeAnalyzer,situp:pose.SitupAnalyzer};
const [exercise,input,side]=process.argv.slice(2);
if(!classes[exercise] || !input) {
  console.error('Usage: node examples/pilot_replay.mjs <exercise> <frames.jsonl> [left|right]');
  process.exit(1);
}
const analyzer=new classes[exercise](side?{side}:{});
const results=fs.readFileSync(input,'utf8').split(/\r?\n/).filter(Boolean).map(line=>analyzer.pushFrame(JSON.parse(line)));
if(process.env.BAROFIT_REPLAY_OUTPUT)fs.writeFileSync(process.env.BAROFIT_REPLAY_OUTPUT,JSON.stringify([...results,...analyzer.finish()]));
console.log(JSON.stringify(analyzer.summary(),null,2));
