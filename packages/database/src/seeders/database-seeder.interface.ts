export interface DatabaseSeeder {
  seed(): Promise<void>;
}
