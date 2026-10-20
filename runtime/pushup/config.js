export default {
  "version": "mobile-stream-1.0",
  "reference_model_id": "bcd336890a294228fba459473b6bd7cf7cbdf0c73ca5602d00ec8cde8a9ff1d3",
  "limits": {
    "hip_low": -8.001899881645222,
    "hip_high": 5.4606967228896615,
    "elbow_max": 113.50822549175545,
    "chest_min": 0.14409963892013125,
    "hand_low": -0.020965572387424178,
    "hand_high": 0.28973163840029553
  },
  "return_elbow_deg": 138.0104231727058,
  "pipeline": {
    "cfg": {
      "target_fps": 15,
      "max_width": 960,
      "visibility_min": 0.5,
      "presence_min": 0.5,
      "ema_tau_s": 0.08,
      "missing_reset_s": 0.4,
      "feedback_hold_s": 0.25,
      "release_ratio": 0.6
    },
    "common": {
      "coverage": 0.8,
      "bottom_window_s": 0.15
    },
    "multi": {
      "result_hold_s": 2.5
    },
    "v3": {
      "exit_knee_deg": 120.0,
      "exit_hold_s": 0.25,
      "exit_resume_knee_deg": 150.0,
      "exit_resume_horizontal": 0.5
    }
  },
  "motion": {
    "elbow_noise_deg": 6.0,
    "shoulder_noise_body": 0.025,
    "return_fraction": 0.7,
    "min_s": 0.5,
    "max_s": 12.0,
    "gap_s": 0.25,
    "merge_bottom_s": 0.45,
    "feedback_wait_s": 0.6,
    "hold_s": 2.5
  },
  "side_warmup_s": 1.0,
  "reference_subjects": [
    "subject_002",
    "subject_006",
    "subject_012",
    "subject_015",
    "subject_018"
  ]
};
