/** Metadata for frame/result transport; frame timestamps are monotonic milliseconds. */
export type Landmark = [number|null, number|null, number|null, number|null, number|null];
export interface PoseFrame {
  timestampMs: number;
  width: number;
  height: number;
  /** Exactly 33 MediaPipe anatomical landmark IDs. */
  landmarks: Landmark[];
}
export type ItemStatus = 'within_reference' | 'warning' | 'tracking_unavailable' |
  'pending_feedback' | 'body_unavailable' | 'body_deviation' | 'interrupted' |
  'unknown' | 'not_applicable' | 'disabled' | 'not_supported';
/** Common app-facing snapshot. Exercise is the discriminator; v1 research outputs are separate. */
export interface FrameResultBase {
  schemaVersion: '2.0';
  type: 'frame.result';
  engineVersion: string;
  timestampMs: number;
  ignored: boolean;
  ignoredReason: 'finished' | 'non_monotonic_timestamp' | null;
  tracking: 'tracking' | 'selecting_side' | 'tracking_unavailable';
  side: 'left' | 'right' | null;
  count: number | null;
  holdSeconds: number | null;
  observedSeconds: number | null;
  measurementBasis: {
    count: 'completed_single_knee_drive_return' | 'completed_threshold_cycle' | 'completed_squat_attempt' | 'completed_attempt' | 'one_leg_out_and_back' | 'completed_open_close_attempt' | 'completed_raise_lower_attempt' | 'completed_bridge_raise_lower_attempt' | 'completed_superman_raise_lower_attempt' | 'completed_pike_lower_raise_attempt' | 'completed_crouch_airborne_land_candidate' | 'completed_knee_tuck_return_candidate' | 'completed_two_leg_alternations_candidate' | 'completed_stand_floor_stand_candidate' | 'completed_torso_raise_return_candidate' | null;
    holdSeconds: 'all_required_items_compliant' | 'observed_holding' | 'observed_raised_still' | null;
    observedSeconds: 'continuous_sample_intervals' | 'continuous_visible_intervals' | null;
  };
  /** Engine movement stage; null where not exposed. Not frontend session lifecycle. */
  phase: string | null;
  /** Current observation ONLY. No entry means not emitted, never automatically compliant. */
  items: Record<string, ItemStatus>;
  /** Existing display candidates, possibly mixing current and recent-repetition feedback. Not a TTS command. */
  codes: string[];
  currentCodes: string[];
  /** Last repetition while the original engine's feedback display window is active; otherwise null. */
  lastRepetition: {
    number: number | null; timestampMs: number | null;
    items: Record<string, ItemStatus>; codes: string[]; metrics: Record<string, unknown>;
  } | null;
  metrics: Record<string, unknown>;
  /** Legacy engine events unchanged. Their t/start_s/end_s fields are seconds. */
  events: Array<{type: string; [key: string]: unknown}>;
}
export interface PushupFrameResult extends FrameResultBase {
  exercise: 'pushup';
  holdSeconds: null; observedSeconds: null; phase: null;
  details: {diagnostics?: unknown; hipStatus?: string | null};
}
export interface PlankFrameResult extends FrameResultBase {
  exercise: 'plank'; count: null; phase: null; lastRepetition: null;
  details: {raw?: Record<string, unknown>};
}
export interface BirdDogFrameResult extends FrameResultBase {
  exercise: 'bird_dog'; lastRepetition: null;
  details: {
    sideCounts?: {left: number; right: number};
    holdingSides?: Array<'left' | 'right'>;
    body?: Record<string, unknown>;
    enginePhase?: string;
    referenceStatus?: string; experimental?: boolean; thresholdBasis?: string;
  };
}
export interface JumpingJackFrameResult extends FrameResultBase {
  exercise: 'jumping_jack'; count: number; holdSeconds: null; details: Record<string, never>;
}
export interface LegRaiseFrameResult extends FrameResultBase {
  exercise: 'leg_raise'; count: number; holdSeconds: null; details: Record<string, never>;
}
export interface GluteBridgeFrameResult extends FrameResultBase {
  exercise: 'glute_bridge'; count: number; holdSeconds: null; details: Record<string, never>;
}
export interface SquatFrameResult extends FrameResultBase {
  exercise: 'squat'; count: number; holdSeconds: null;
  details: {state?: string; raw?: Record<string,unknown>; sourceCommit?: string; experimental?: boolean; selectionMode?: string};
}
export interface CycleFrameResult extends FrameResultBase {
  exercise: 'lunge' | 'split_squat' | 'bulgarian_split_squat' | 'incline_pushup' | 'standing_calf_raise' | 'side_lying_leg_raise' | 'dead_bug';
  count: number; holdSeconds: null; details: Record<string, never>;
}
export interface MountainClimberFrameResult extends FrameResultBase {
  exercise: 'mountain_climber'; count: number; holdSeconds: null; details: Record<string, never>;
}
export interface SidePlankFrameResult extends FrameResultBase { exercise: 'side_plank'; count: null; holdSeconds: number; lastRepetition: null; details: Record<string,never>; }
export interface PilotFrameResult extends FrameResultBase {
  exercise: 'jump_squat' | 'reverse_crunch' | 'flutter_kicks' | 'burpee' | 'situp';
  count: number; holdSeconds: null;
  details: {experimental: true; postureAssessment: 'unreviewed'};
}
export type FrameResult = PilotFrameResult | SidePlankFrameResult | MountainClimberFrameResult | CycleFrameResult | SquatFrameResult | PushupFrameResult | PlankFrameResult | BirdDogFrameResult | JumpingJackFrameResult | LegRaiseFrameResult | GluteBridgeFrameResult | SupermanFrameResult | PikePushupFrameResult;

/** Set-result v2 unchanged. Non-terminal engine event payloads retain their v1 contracts. */
export interface ItemSummary {
  aggregationBasis: 'repetition' | 'time';
  unit: 'repetitions' | 'seconds';
  compliant: number;
  warning: number;
  unknown: number;
  notApplicable: number;
  evaluated: number;
  /** 0–100 inclusive; null when evaluated === 0. */
  compliancePct: number | null;
}
export interface SetSummary {
  schemaVersion: '2.0';
  exercise: string;
  engineVersion: string;
  count: number | null;
  holdSeconds: number | null;
  observedSeconds: number | null;
  gapSeconds: number | null;
  items: Record<string, ItemSummary>;
  details: Partial<CommonSetDetails> & Record<string, unknown>;
}
export interface SetCompleted {
  schemaVersion: '2.0';
  type: 'set.completed';
  exercise: string;
  engineVersion: string;
  /** Same time origin as input PoseFrame, milliseconds; null before the first frame. */
  timestampMs: number | null;
  summary: SetSummary;
}

export interface SupermanFrameResult extends FrameResultBase {
 exercise: 'superman'; count: number; holdSeconds: number; details: Record<string, never>;
}

export interface PikePushupFrameResult extends FrameResultBase {
 exercise: 'pike_pushup'; count: number; holdSeconds: null; details: Record<string, never>;
}

/** Separate camera observability event; does not alter frame.result / set.completed v2. */
export interface CameraReadinessResult {
  schemaVersion: '1.0'; type: 'camera.readiness'; exercise: string; timestampMs: number;
  ignored: boolean; ignoredReason: 'non_monotonic_timestamp' | null;
  status: 'no_person' | 'adjust_camera' | 'stabilizing' | 'ready';
  ready: boolean; observable: boolean;
  selectedSide: 'left' | 'right' | 'both' | null;
  candidateSide: 'left' | 'right' | 'both' | null;
  missingLandmarks: string[]; outOfFrameLandmarks: string[];
  reasonCode: 'STABILIZING' | 'NO_PERSON' | 'BODY_OUT_OF_FRAME' | 'MISSING_LANDMARK' | 'LOW_VISIBILITY' | 'LOW_PRESENCE' | null;
  message: string; stableForMs: number;
}

/** Session lifecycle is separate from frame.result movement phase and form assessment. */
export type SessionPhase = 'waiting_for_pose' | 'active' | 'recognition_lost' |
  'auto_paused' | 'countdown' | 'manually_paused' | 'finished';
export interface SessionState {
  schemaVersion: '1.0';
  type: 'session.state';
  exercise: string;
  timestampMs: number | null;
  phase: SessionPhase;
  ignored: boolean;
  ignoredReason: 'finished' | 'non_monotonic_timestamp' | null;
  measurementEnabled: boolean;
  recognition: {
    observable: boolean;
    stable: boolean;
    side: 'left' | 'right' | 'both' | null;
    reasonCode: string | null;
    observedAtMs: number | null;
  };
  lossDurationMs: number;
  countdownRemainingMs: number | null;
  /** Only the current forwarded frame; null during suspension/countdown/ticks. */
  frameResult: FrameResult | null;
  /** Session events use timestampMs; forwarded analyzer interruption events keep their original units. */
  events: Array<{type: string; [key: string]: unknown}>;
  summary: SetSummary;
}

export interface RepetitionSummary {
  number: number;
  timestampMs: number | null;
  side: 'left' | 'right' | null;
  items: Record<string, ItemStatus>;
  codes: string[];
  metrics: Record<string, unknown>;
  [key: string]: unknown;
}
export interface SetReport {
  schemaVersion: '1.0';
  feedbackCodes: string[];
  errorCounts: Record<string, number>;
  errorCountBasis: 'per_code';
  errorCountBasisByCode: Record<string, 'warning_episodes' | 'completed_repetitions'>;
  repetitionErrorCounts: Record<string, number>;
  warningEpisodeCounts: Record<string, number>;
  warningSeconds: Record<string, number>;
  postureScore: number | null;
  scoreBasis: 'mean_of_evaluated_item_compliance_pct';
  evaluatedItemCount: number;
  trackingAvailablePct: number | null;
  tracking: {
    basis: 'analyzer_continuous_intervals' | 'session_observability_intervals';
    totalSeconds: number;
    availableSeconds: number;
    unavailableSeconds: number;
    acceptedFrames: number;
  };
  lateFormBreakdown: {
    candidate: boolean | null;
    earlyScore: number | null;
    lateScore: number | null;
    dropPoints: number | null;
    thresholdPoints: number;
    comparisonBasis: 'repetition_halves' | 'evaluated_time_halves';
    minimumEvaluatedPerItem: number;
    unit: 'seconds' | 'repetitions';
    itemIds: string[];
    reason: 'compared' | 'insufficient_evaluated_data' | 'incomplete_repetition_records' | 'tracking_unavailable_at_end';
  };
  repetitionRecordsComplete: boolean | null;
}
export interface CommonSetDetails {
  repetitions: RepetitionSummary[];
  sideCounts: {left: number; right: number} | null;
  sideHoldSeconds: {left: number; right: number} | null;
  itemLabels: Record<string, string>;
  report: SetReport;
  [key: string]: unknown;
}

/** All current JS Analyzer implementations provide these additive common details. */
export interface ReportedSetSummary extends SetSummary { details: CommonSetDetails; }
