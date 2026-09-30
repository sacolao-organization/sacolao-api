import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ProductsService } from './products.service';
import { AuthGuard } from '../auth/auth.guard';

@UseGuards(AuthGuard)
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  async getProducts(@Query('month') month: string) {
    return await this.productsService.getProductsFromMonth(month);
  }

  @Get('months')
  async getAvailableMonths() {
    return await this.productsService.getAvailableMonths();
  }

  @Get('processor-data')
  async getProductsForProcessor(
    @Query('storeId') storeId?: string,
    @Query('group') group?: string,
  ) {
    return await this.productsService.getProductsForProcessor(storeId, group);
  }

  @Get('locked-months')
  async getLockedMonths() {
    return await this.productsService.getLockedMonths();
  }

  @Post('toggle-lock')
  async toggleLockMonth(@Body('month') month: string) {
    return await this.productsService.toggleLockMonth(month);
  }

  @Put('bulk-update')
  async bulkUpdateProducts(@Body('products') products: any[]) {
    return await this.productsService.bulkUpdate(products);
  }

  

  @Delete(':id')
  async deleteProduct(@Param('id') id: string) {
    return await this.productsService.deleteProduct(id);
  }
}
