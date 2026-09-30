import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { DatabaseSeeder } from './seeders/database-seeder.interface';
import { PimSeeder } from './seeders/pim.seeder';

@Injectable()
export class DatabaseSeederService implements OnModuleInit {
  private readonly logger = new Logger(DatabaseSeederService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  async onModuleInit() {
    this.logger.log('Starting database seeding process...');

    const seeders: DatabaseSeeder[] = [new PimSeeder(this.databaseService)];
    for (const seeder of seeders) {
      await seeder.seed();
    }

    this.logger.log('Database seeding completed successfully.');
  }
}
