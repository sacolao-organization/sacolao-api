import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma.service';
import axios from 'axios';

@Injectable()
export class AiService {
  constructor(private readonly prisma: PrismaService) {}

  async generateResponse(user: any, question: string) {
    let contextData = '';
    const qLower = question.toLowerCase();

    if (
      user.permissions['pdvs.access'] &&
      (qLower.includes('caixa') ||
        qLower.includes('venda') ||
        qLower.includes('pdv'))
    ) {
      const registers = await this.prisma.cash_registers.findMany({
        select: {
          id: true,
          description: true,
          stores: { select: { number: true } },
        },
      });

      const lastSales = await this.prisma.daily_sales.groupBy({
        by: ['cash_register_id'],
        _max: { report_date: true },
        where: { OR: [{ total_nfce: { gt: 0 } }, { total_nfe: { gt: 0 } }] },
      });

      const today = new Date();
      const outdated: string[] = [];

      for (const reg of registers) {
        const sale = lastSales.find((s) => s.cash_register_id === reg.id);
        const lastDate = sale?._max?.report_date;

        if (lastDate) {
          const diffDays = Math.ceil(
            Math.abs(today.getTime() - new Date(lastDate).getTime()) /
              (1000 * 60 * 60 * 24),
          );
          if (diffDays > 5) {
            outdated.push(
              `Loja ${reg.stores?.number} - ${reg.description} (Sem vendas há ${diffDays} dias)`,
            );
          }
        } else {
          outdated.push(
            `Loja ${reg.stores?.number} - ${reg.description} (Nenhuma venda registrada)`,
          );
        }
      }

      contextData += `\n[DADOS DE CAIXAS]: Os seguintes caixas estão desatualizados ou sem vendas há mais de 5 dias:\n${outdated.join('\n')}`;
    }

    const systemPrompt = `Você é o assistente virtual do sistema.
    Responda à pergunta do usuário de forma rápida, curta e direta.
    Utilize SOMENTE os dados de contexto abaixo caso a pergunta seja sobre o sistema:
    ${contextData}
    
    Se não houver dados no contexto para responder, diga que você ainda não tem essa informação carregada.`;

    try {
      const response = await axios.post(
        'http://localhost:20128/v1/chat/completions',
        {
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: question },
          ],
          temperature: 0.3,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.ROUTER_TOKEN}`,
          },
        },
      );

      return response.data.choices[0].message.content;
    } catch (error: any) {
      console.error('Erro ao conectar com o 9Router:', error.message);
      throw new Error('Falha na comunicação com a IA local.');
    }
  }
}
