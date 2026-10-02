import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { SuppliersModule } from './suppliers/suppliers.module';
import { NotesRuralSuppliersModule } from './notes-rural-suppliers/notes-rural-suppliers.module';
import { DailySalesModule } from './daily-sales/daily-sales.module';
import { StoresModule } from './stores/stores.module';
import { ReleasesModule } from './releases/releases.module';
import { AuthModule } from './auth/auth.module';
import { ProductsModule } from './products/products.module';
import { AdminService } from './admin/admin.service';
import { AdminModule } from './admin/admin.module';
import { AiService } from './ai/ai.service';
import { AiModule } from './ai/ai.module';

@Module({
  imports: [
    SuppliersModule,
    NotesRuralSuppliersModule,
    DailySalesModule,
    StoresModule,
    ReleasesModule,
    AuthModule,
    ProductsModule,
    AdminModule,
    AiModule,
  ],
  controllers: [],
  providers: [PrismaService, AdminService, AiService],
})
export class AppModule {}
