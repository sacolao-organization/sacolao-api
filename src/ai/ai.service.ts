import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma.service';
import axios from 'axios';

@Injectable()
export class AiService {
  constructor(private readonly prisma: PrismaService) {}

  async generateResponse(user: any, question: string) {
    let contextData = '';
    const qLower = question.toLowerCase();

    const hasPdvsAccess = 
  user?.permissions?.pdvs?.access || 
  user?.permissions?.pdvs?.tabs?.dashboard?.view || 
  user?.permissions?.pdvs?.tabs?.access;

    if (hasPdvsAccess) {
  const registers = await this.prisma.cash_registers.findMany({
    include: {
      stores: true,
    },
  });

  const lastSales = await this.prisma.daily_sales.findMany({
    orderBy: {
      report_date: 'desc',
    },
  });

  contextData = `
[DADOS DO SISTEMA - SOMENTE LEITURA]

IMPORTANTE:
- Estes dados são somente para consulta.
- Você NÃO possui permissão para alterar o banco de dados.
- NUNCA execute, sugira executar ou simule operações de INSERT, UPDATE, DELETE, CREATE, ALTER, DROP ou qualquer outra alteração.
- Se o usuário pedir para alterar, excluir, cadastrar, editar ou modificar qualquer dado, responda que você não possui permissão para realizar alterações.
- Você pode responder perguntas sobre os dados abaixo normalmente.
- Não invente informações que não estejam nos dados fornecidos.

[PDVs]
${JSON.stringify(registers, null, 2)}

[VENDAS]
${JSON.stringify(lastSales, null, 2)}
`;
}

    const systemPrompt = `
Você é o assistente virtual do sistema.

Sua função é SOMENTE CONSULTAR E EXPLICAR informações do sistema.

REGRAS ABSOLUTAS:

1. Você é SOMENTE LEITURA.
2. Você NUNCA pode modificar o banco de dados.
3. Você NUNCA pode cadastrar, editar, excluir ou alterar informações.
4. Você NUNCA deve executar ou fornecer instruções para executar operações SQL de alteração.
5. Se o usuário pedir para modificar qualquer informação, diga que você não possui permissão para realizar alterações.
6. Responda perguntas sobre os dados disponíveis no contexto.
7. Use SOMENTE informações presentes no contexto para responder perguntas sobre o sistema.
8. Nunca invente números, PDVs, lojas, vendas ou qualquer outro dado.
9. Se a informação realmente não estiver no contexto, diga que essa informação não está disponível.
10. Você pode fazer cálculos usando os dados disponíveis, como contar PDVs, comparar datas, calcular quantidades e identificar situações.
11. Responda de forma curta, clara e direta.

${contextData}
`;

    try {
      const response = await axios.post(
        'http://localhost:20128/v1/chat/completions',
        {
          model: 'oc/mimo-v2.5-free',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: question },
          ],stream: false,
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
