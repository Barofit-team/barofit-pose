import {ExerciseSessionController} from '../runtime/index.js';

/** Live-camera integration example. All timestamps use the same performance.now() clock. */
export function createLivePoseSession({onState=()=>{},onFrame=()=>{},...options}) {
  const controller=new ExerciseSessionController(options);
  const deliver=state=>{
    if(!state.ignored) {
      onState(state);
      if(state.frameResult)onFrame(state.frameResult);
    }
    return state;
  };
  // Keep this running during pause/countdown so a stopped camera can be detected.
  const watchdog=setInterval(()=>deliver(controller.tick(performance.now())),100);
  return {
    controller,
    pushFrame(packet){return deliver(controller.pushFrame({...packet,timestampMs:performance.now()}));},
    pause(){return deliver(controller.pause());},
    resume(){return deliver(controller.resume());},
    finish(){
      clearInterval(watchdog);
      const events=controller.finish();
      onState(controller.getState());
      return events;
    },
  };
}
