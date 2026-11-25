export type BodySize = 'petite' | 'average' | 'tall';

export function bodySizeFromHeight(heightCm?: number | null): BodySize {
  if (!heightCm || heightCm <= 0) return 'average';
  if (heightCm < 155) return 'petite';
  if (heightCm > 175) return 'tall';
  return 'average';
}

export function referenceGenerateFields(input: {
  pose: boolean;
  poseStrength: number;
  fit: boolean;
  body: BodySize;
  copy: boolean;
  denoise: number;
  style: boolean;
  styleStrength: number;
  heightCm?: number | null;
  bustCm?: number | null;
  hipCm?: number | null;
}): Record<string, string | number | boolean | null> {
  return {
    pose: input.pose,
    pose_strength: input.poseStrength,
    pose_fit: input.fit,
    pose_body: input.body,
    pose_height_cm: input.heightCm ?? null,
    pose_bust_cm: input.bustCm ?? null,
    pose_hip_cm: input.hipCm ?? null,
    copy_picture: input.copy,
    strength: input.denoise,
    style: input.style,
    style_strength: input.styleStrength,
  };
}
