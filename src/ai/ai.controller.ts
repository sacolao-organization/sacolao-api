import { Controller, Post, Body, Req, UseGuards } from '@nestjs/common';
import { AiService } from './ai.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @UseGuards(AuthGuard)
  @Post('chat')
  async chat(
    @Req() req,
    @Body('messages') messages: Array<{ role: 'user' | 'ai'; content: string }>,
  ) {
    const answer = await this.aiService.generateResponse(req.user, messages);
    return { answer };
  }
}
