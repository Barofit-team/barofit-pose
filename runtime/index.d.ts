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

