export default async function setup(): Promise<void> {
  process.env.VITEST = 'true';
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET ||= 'test-secret-test-secret-test-secret-32';
  process.env.DATABASE_URL ||= 'mysql://oinur:oinur@localhost:3306/oinur_test';
}
