import {requireNativeComponent, NativeModules} from 'react-native';
export const PoseCamera = requireNativeComponent('BarofitPoseView');
export const PoseVoice = NativeModules.BarofitPoseVoice;
export const PoseDiagnostics = NativeModules.BarofitPoseDiagnostics;

export const PoseVideo = requireNativeComponent('BarofitVideoPoseView');
export const PoseMedia = NativeModules.BarofitPoseMedia;
