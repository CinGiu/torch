import { z } from 'zod';

export const loginSchema = z.object({
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Invalid email address')
    .refine(email => email.endsWith('@cubbit.io'), 'Only Cubbit emails allowed'),
  password: z
    .string()
    .min(1, 'Password is required')
    .min(8, 'Password must be at least 8 characters'),
});

export const tfaSchema = z.object({
  tfaCode: z
    .string()
    .length(6, 'Code must be 6 digits')
    .regex(/^\d+$/, 'Code must contain only digits'),
});

export const githubConfigSchema = z.object({
  token: z.string().min(1, 'GitHub token is required'),
  webhook_secret: z.string().min(1, 'Webhook secret is required'),
  trigger_label: z.string().min(1, 'Trigger label is required'),
  base_branch: z.string().min(1, 'Base branch is required'),
});

export const pipelineConfigSchema = z.object({
  test_command: z.string().min(1, 'Test command is required'),
  lint_command: z.string().min(1, 'Lint command is required'),
  workspaces_dir: z.string().min(1, 'Workspaces directory is required'),
});
