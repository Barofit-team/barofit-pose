export * from './common/contracts.js';

export interface CameraReadinessOptions {
  exercise: string;
  side?: 'left' | 'right' | null;
  minVisibility?: number;
  minPresence?: number;
  stableMs?: number;
  lostMs?: number;
  maxGapMs?: number;
}

export declare class CameraReadiness {
  exercise: string;
  ready: boolean;
  selectedSide: 'left' | 'right' | 'both' | null;
  constructor(options: CameraReadinessOptions);
  reset(): void;
  breakContinuity(reason?: string): void;
  pushFrame(frame: import('./common/contracts.js').PoseFrame): import('./common/contracts.js').CameraReadinessResult;
}

export declare const READINESS_PROFILES: Record<string, { mode: 'either' | 'both'; joints: readonly string[] }>;

export interface BaseExerciseAnalyzer<TFrameResult = import('./common/contracts.js').FrameResult> {
  pushFrame(frame: import('./common/contracts.js').PoseFrame): TFrameResult;
  breakContinuity(reason?: 'pause'): unknown;
  summary(): import('./common/contracts.js').SetSummary;
  finish(): Array<import('./common/contracts.js').SetCompleted | (Record<string, unknown> & { schemaVersion: string; type: string; exercise: string })>;
}

export declare class PushupAnalyzer implements BaseExerciseAnalyzer<import('./common/contracts.js').PushupFrameResult> {
  constructor(settings?: Record<string, unknown>);
  pushFrame(frame: import('./common/contracts.js').PoseFrame): import('./common/contracts.js').PushupFrameResult;
  breakContinuity(reason?: 'pause'): unknown;
  summary(): import('./common/contracts.js').SetSummary;
  finish(): Array<import('./common/contracts.js').SetCompleted | (Record<string, unknown> & { schemaVersion: string; type: string; exercise: string })>;
}

export declare class PlankAnalyzer implements BaseExerciseAnalyzer<import('./common/contracts.js').PlankFrameResult> {
  constructor();
  pushFrame(frame: import('./common/contracts.js').PoseFrame): import('./common/contracts.js').PlankFrameResult;
  breakContinuity(reason?: 'pause'): unknown;
  summary(): import('./common/contracts.js').SetSummary;
  finish(): Array<import('./common/contracts.js').SetCompleted | (Record<string, unknown> & { schemaVersion: string; type: string; exercise: string })>;
}

export declare class SquatAnalyzer implements BaseExerciseAnalyzer<import('./common/contracts.js').SquatFrameResult> {
  constructor(options?: Record<string, unknown>);
  pushFrame(frame: import('./common/contracts.js').PoseFrame): import('./common/contracts.js').SquatFrameResult;
  breakContinuity(reason?: 'pause'): unknown;
  summary(): import('./common/contracts.js').SetSummary;
  finish(): Array<import('./common/contracts.js').SetCompleted | (Record<string, unknown> & { schemaVersion: string; type: string; exercise: string })>;
}

export declare class BirdDogAnalyzer implements BaseExerciseAnalyzer<import('./common/contracts.js').BirdDogFrameResult> {
  constructor(options?: Record<string, unknown>);
  pushFrame(frame: import('./common/contracts.js').PoseFrame): import('./common/contracts.js').BirdDogFrameResult;
  breakContinuity(reason?: 'pause'): unknown;
  summary(): import('./common/contracts.js').SetSummary;
  finish(): Array<import('./common/contracts.js').SetCompleted | (Record<string, unknown> & { schemaVersion: string; type: string; exercise: string })>;
}

export declare class JumpingJackAnalyzer implements BaseExerciseAnalyzer<import('./common/contracts.js').JumpingJackFrameResult> {
  constructor(options?: Record<string, unknown>);
  pushFrame(frame: import('./common/contracts.js').PoseFrame): import('./common/contracts.js').JumpingJackFrameResult;
  breakContinuity(reason?: 'pause'): unknown;
  summary(): import('./common/contracts.js').SetSummary;
  finish(): Array<import('./common/contracts.js').SetCompleted | (Record<string, unknown> & { schemaVersion: string; type: string; exercise: string })>;
}

export declare class LegRaiseAnalyzer implements BaseExerciseAnalyzer<import('./common/contracts.js').LegRaiseFrameResult> {
  constructor(options?: Record<string, unknown>);
  pushFrame(frame: import('./common/contracts.js').PoseFrame): import('./common/contracts.js').LegRaiseFrameResult;
  breakContinuity(reason?: 'pause'): unknown;
  summary(): import('./common/contracts.js').SetSummary;
  finish(): Array<import('./common/contracts.js').SetCompleted | (Record<string, unknown> & { schemaVersion: string; type: string; exercise: string })>;
}

export declare class GluteBridgeAnalyzer implements BaseExerciseAnalyzer<import('./common/contracts.js').GluteBridgeFrameResult> {
  constructor(options?: Record<string, unknown>);
  pushFrame(frame: import('./common/contracts.js').PoseFrame): import('./common/contracts.js').GluteBridgeFrameResult;
  breakContinuity(reason?: 'pause'): unknown;
  summary(): import('./common/contracts.js').SetSummary;
  finish(): Array<import('./common/contracts.js').SetCompleted | (Record<string, unknown> & { schemaVersion: string; type: string; exercise: string })>;
}

export declare class SupermanAnalyzer implements BaseExerciseAnalyzer<import('./common/contracts.js').SupermanFrameResult> {
  constructor(options?: Record<string, unknown>);
  pushFrame(frame: import('./common/contracts.js').PoseFrame): import('./common/contracts.js').SupermanFrameResult;
  breakContinuity(reason?: 'pause'): unknown;
  summary(): import('./common/contracts.js').SetSummary;
  finish(): Array<import('./common/contracts.js').SetCompleted | (Record<string, unknown> & { schemaVersion: string; type: string; exercise: string })>;
}

export declare class PikePushupAnalyzer implements BaseExerciseAnalyzer<import('./common/contracts.js').PikePushupFrameResult> {
  constructor(options?: Record<string, unknown>);
  pushFrame(frame: import('./common/contracts.js').PoseFrame): import('./common/contracts.js').PikePushupFrameResult;
  breakContinuity(reason?: 'pause'): unknown;
  summary(): import('./common/contracts.js').SetSummary;
  finish(): Array<import('./common/contracts.js').SetCompleted | (Record<string, unknown> & { schemaVersion: string; type: string; exercise: string })>;
}

export declare class MountainClimberAnalyzer implements BaseExerciseAnalyzer<import('./common/contracts.js').MountainClimberFrameResult> {
  constructor(options?: Record<string, unknown>);
  pushFrame(frame: import('./common/contracts.js').PoseFrame): import('./common/contracts.js').MountainClimberFrameResult;
  breakContinuity(reason?: 'pause'): unknown;
  summary(): import('./common/contracts.js').SetSummary;
  finish(): Array<import('./common/contracts.js').SetCompleted | (Record<string, unknown> & { schemaVersion: string; type: string; exercise: string })>;
}

export declare class LungeAnalyzer implements BaseExerciseAnalyzer<import('./common/contracts.js').CycleFrameResult> {
  constructor(options?: { side?: 'left' | 'right' | null });
  pushFrame(frame: import('./common/contracts.js').PoseFrame): import('./common/contracts.js').CycleFrameResult;
  breakContinuity(reason?: 'pause'): unknown;
  summary(): import('./common/contracts.js').SetSummary;
  finish(): Array<import('./common/contracts.js').SetCompleted | (Record<string, unknown> & { schemaVersion: string; type: string; exercise: string })>;
}

export declare class SplitSquatAnalyzer implements BaseExerciseAnalyzer<import('./common/contracts.js').CycleFrameResult> {
  constructor(options?: { side?: 'left' | 'right' | null });
  pushFrame(frame: import('./common/contracts.js').PoseFrame): import('./common/contracts.js').CycleFrameResult;
  breakContinuity(reason?: 'pause'): unknown;
  summary(): import('./common/contracts.js').SetSummary;
  finish(): Array<import('./common/contracts.js').SetCompleted | (Record<string, unknown> & { schemaVersion: string; type: string; exercise: string })>;
}

export declare class BulgarianSplitSquatAnalyzer implements BaseExerciseAnalyzer<import('./common/contracts.js').CycleFrameResult> {
  constructor(options?: { side?: 'left' | 'right' | null });
  pushFrame(frame: import('./common/contracts.js').PoseFrame): import('./common/contracts.js').CycleFrameResult;
  breakContinuity(reason?: 'pause'): unknown;
  summary(): import('./common/contracts.js').SetSummary;
  finish(): Array<import('./common/contracts.js').SetCompleted | (Record<string, unknown> & { schemaVersion: string; type: string; exercise: string })>;
}

export declare class InclinePushupAnalyzer implements BaseExerciseAnalyzer<import('./common/contracts.js').CycleFrameResult> {
  constructor(options?: { side?: 'left' | 'right' | null });
  pushFrame(frame: import('./common/contracts.js').PoseFrame): import('./common/contracts.js').CycleFrameResult;
  breakContinuity(reason?: 'pause'): unknown;
  summary(): import('./common/contracts.js').SetSummary;
  finish(): Array<import('./common/contracts.js').SetCompleted | (Record<string, unknown> & { schemaVersion: string; type: string; exercise: string })>;
}

export declare class StandingCalfRaiseAnalyzer implements BaseExerciseAnalyzer<import('./common/contracts.js').CycleFrameResult> {
  constructor(options?: { side?: 'left' | 'right' | null });
  pushFrame(frame: import('./common/contracts.js').PoseFrame): import('./common/contracts.js').CycleFrameResult;
  breakContinuity(reason?: 'pause'): unknown;
  summary(): import('./common/contracts.js').SetSummary;
  finish(): Array<import('./common/contracts.js').SetCompleted | (Record<string, unknown> & { schemaVersion: string; type: string; exercise: string })>;
}

export declare class SideLegRaiseAnalyzer implements BaseExerciseAnalyzer<import('./common/contracts.js').CycleFrameResult> {
  constructor(options?: { side?: 'left' | 'right' | null });
  pushFrame(frame: import('./common/contracts.js').PoseFrame): import('./common/contracts.js').CycleFrameResult;
  breakContinuity(reason?: 'pause'): unknown;
  summary(): import('./common/contracts.js').SetSummary;
  finish(): Array<import('./common/contracts.js').SetCompleted | (Record<string, unknown> & { schemaVersion: string; type: string; exercise: string })>;
}

export declare class DeadBugAnalyzer implements BaseExerciseAnalyzer<import('./common/contracts.js').CycleFrameResult> {
  constructor(options?: { side?: 'left' | 'right' | null });
  pushFrame(frame: import('./common/contracts.js').PoseFrame): import('./common/contracts.js').CycleFrameResult;
  breakContinuity(reason?: 'pause'): unknown;
  summary(): import('./common/contracts.js').SetSummary;
  finish(): Array<import('./common/contracts.js').SetCompleted | (Record<string, unknown> & { schemaVersion: string; type: string; exercise: string })>;
}

export declare class SidePlankAnalyzer implements BaseExerciseAnalyzer<import('./common/contracts.js').SidePlankFrameResult> {
  constructor();
  reset(): void;
  pushFrame(frame: import('./common/contracts.js').PoseFrame): import('./common/contracts.js').SidePlankFrameResult;
  breakContinuity(reason?: 'pause'): unknown;
  summary(): import('./common/contracts.js').SetSummary;
  finish(): Array<import('./common/contracts.js').SetCompleted | (Record<string, unknown> & { schemaVersion: string; type: string; exercise: string })>;
}

export interface MoveNetPushupOptions {
  shortGapMs?: number;
  elbowIndependent?: boolean;
}

export type MoveNetKeypoint = [number, number, number];

export declare function moveNetLandmarks(keypoints: MoveNetKeypoint[]): import('./common/contracts.js').Landmark[];

export declare class MoveNetPushupAnalyzer extends PushupAnalyzer {
  constructor(options?: MoveNetPushupOptions);
  pushKeypoints(packet: {
    timestampMs: number;
    width: number;
    height: number;
    keypoints: MoveNetKeypoint[];
  }): import('./common/contracts.js').PushupFrameResult;
}

export declare class PushupEngine {
  side: 'left' | 'right' | null;
  count: number;
  closed: boolean;
  constructor(options?: { side?: 'auto' | 'left' | 'right'; settings?: Record<string, unknown> });
  pushFrame(frame: import('./common/contracts.js').PoseFrame): Record<string, unknown>;
  pushFeatures(features: Record<string, unknown>): Record<string, unknown>;
  breakContinuity(): Array<Record<string, unknown>>;
  finish(): Array<Record<string, unknown>>;
}

export declare class LivePushupEngine {
  core: PushupEngine;
  side: 'left' | 'right' | null;
  readonly count: number;
  closed: boolean;
  constructor(settings?: Record<string, unknown>);
  pushFrame(packet: import('./common/contracts.js').PoseFrame): Record<string, unknown>;
  breakContinuity(reason?: string): Array<Record<string, unknown>>;
  finish(): Array<Record<string, unknown>>;
}

export declare function inspectSide(
  packet: import('./common/contracts.js').PoseFrame,
  side: 'left' | 'right',
  settings?: Record<string, unknown>,
): {
  ready: boolean;
  quality: number;
  reasons: string[];
  joints: Record<string, { id: number; visibility: number | null; presence: number | null; ok: boolean; reason: string | null }>;
  features: Record<string, number>;
};

export declare class FeedbackVoice {
  constructor(options?: { sameMs?: number; gapMs?: number; now?: () => number });
  cancel(): void;
  update(
    result: { tracking?: string; codes?: string[] },
    enabled: boolean,
    speakIfIdle: (text: string) => Promise<boolean> | boolean,
    texts: Record<string, string>,
  ): Promise<string | null>;
}

export declare function supermanMetrics(
  frame: import('./common/contracts.js').PoseFrame,
  side: 'left' | 'right',
  visibility?: number,
): Record<string, unknown> | null;

export declare const PUSHUP_TEXT: Readonly<Record<string, string>>;
export declare const PLANK_VERSION: string;
export declare const SQUAT_VERSION: string;
export declare const BIRD_DOG_VERSION: string;
export declare const JUMPING_JACK_VERSION: string;
export declare const JACK_CONFIG: Readonly<Record<string, unknown>>;
export declare const LEG_RAISE_VERSION: string;
export declare const LEG_RAISE_CONFIG: Readonly<Record<string, unknown>>;
export declare const MOVENET_PUSHUP_VERSION: string;
export declare const GLUTE_BRIDGE_VERSION: string;
export declare const GLUTE_BRIDGE_CONFIG: Readonly<Record<string, unknown>>;
export declare const SUPERMAN_CONFIG: Readonly<Record<string, unknown>>;
export declare const SUPERMAN_VERSION: string;
export declare const PIKE_PUSHUP_CONFIG: Readonly<Record<string, unknown>>;
export declare const PIKE_PUSHUP_VERSION: string;
export declare const PIKE_PUSHUP_TEXT: Readonly<Record<string, string>>;
export declare const CLIMBER_VERSION: string;
export declare const SIDE_PLANK_CONFIG: Readonly<Record<string, unknown>>;
export declare const SIDE_PLANK_VERSION: string;


