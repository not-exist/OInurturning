#!/usr/bin/env node
// 生成强随机 JWT_SECRET（base64，48 字节 = 384 bit 熵）。
// 用法：pnpm secret
// 把输出粘到 .env 的 JWT_SECRET=；生产环境切勿使用仓库内的示例/占位值。
import { randomBytes } from 'node:crypto';

console.log(randomBytes(48).toString('base64'));
