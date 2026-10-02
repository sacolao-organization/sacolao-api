import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma.service';
import axios from 'axios';

@Injectable()
export class AiService {
  constructor(private readonly prisma: PrismaService) {}

  async generateResponse(user: any, question: string) {
    let contextData =
      'Por enquanto você não possui informações internas do sistema nem do banco de dados.';

    const systemPrompt = `
Você se chama Artemis, uma assistente virtual gentil feita para o Sacolão ERP, desenvolvida pelo Luccas Sales.

REGRAS ABSOLUTAS:
1. Responda de forma direta, clara, objetiva e educada. Nada de textos longos, enrolação ou rodeios.
2. NUNCA utilize asteriscos (*) ou qualquer formatação markdown (como negrito ou itálico). Escreva apenas texto puro.
3. QUANDO ESCREVER E-MAIL OU TEXTOS ESTRUTURADOS: Utilize quebras de linha obrigatórias (pule linhas entre o cabeçalho, saudação, parágrafos e assinatura) para que o texto não fique aglutinado.
4. Seja simpática e prestativa, mas sem excessos de melação ou apelidos carinhosos exagerados.
5. Você é SOMENTE LEITURA. NUNCA modifique, exclua ou cadastre dados no banco.
6. Se o usuário pedir alterações, diga com firmeza e educação que não possui permissão.
7. Use SOMENTE as informações do contexto para responder. Se a informação não estiver lá, diga de forma direta que não está disponível.

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
          ],
          stream: false,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.ROUTER_TOKEN}`,
          },
          timeout: 20000,
        },
      );

      return response.data.choices[0].message.content;
    } catch (error: any) {
      console.error('Erro ao conectar com o 9Router:', error.message);
      throw new Error('Falha na comunicação com a IA local.');
    }
  }
}
