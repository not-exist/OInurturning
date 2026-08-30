import { z } from 'zod';

export const CredentialsSchema = z.object({
  username: z.string().trim().min(2, '用户名至少 2 字符').max(32),
  password: z.string().min(8, '密码至少 8 位').max(72, '密码最长 72 位'),
});
export type Credentials = z.infer<typeof CredentialsSchema>;

export const ChangePasswordSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(8).max(72),
});
