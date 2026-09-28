import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CreateNotesRuralSuppliersListDTO,
  UpdateNoteRuralSuppliersDTO,
} from 'src/dtos/notes-rural-suppliers';
import { PrismaService } from 'src/prisma.service';

@Injectable()
export class NotesRuralSuppliersService {
  private readonly logger = new Logger(NotesRuralSuppliersService.name);

  constructor(private prismaService: PrismaService) {}

  async createNotesRuralSuppliers(payload: CreateNotesRuralSuppliersListDTO) {
    this.logger.log(
      `Iniciando processamento de ${payload.notes.length} notas de produtores rurais`,
    );

    let createdCount = 0;
    let updatedCount = 0;

    const suppliers = await this.prismaService.suppliers.findMany({
      select: {
        tax_id: true,
        legal_name: true,
        sector: true,
      },
    });

    const suppliersMap = new Map(
      suppliers.map((s) => [
        s.tax_id,
        { name: s.legal_name, sector: s.sector },
      ]),
    );

    for (const item of payload.notes) {
      const supplierInfo = suppliersMap.get(item.supplier_tax_id);
      const supplierName = supplierInfo ? supplierInfo.name : null;
      const sector = supplierInfo ? supplierInfo.sector : null;

      const existingNotes =
        await this.prismaService.notes_rural_suppliers.findMany({
          where: {
            OR: [
              {
                note_access_key: item.note_access_key
                  ? item.note_access_key
                  : undefined,
              },
              {
                receipt_access_key: item.receipt_access_key
                  ? item.receipt_access_key
                  : undefined,
              },
            ].filter((condition) => Object.values(condition)[0] !== undefined),
          },
        });

      if (existingNotes.length > 0) {
        let notesToUpdate = existingNotes;

        if (item.receipt_access_key) {
          const exactMatch = existingNotes.filter(
            (n) => n.receipt_access_key === item.receipt_access_key,
          );

          if (exactMatch.length > 0) {
            notesToUpdate = exactMatch;
          } else {
            const hasDifferent = existingNotes.some(
              (n) =>
                Boolean(n.receipt_access_key) &&
                n.receipt_access_key !== item.receipt_access_key,
            );

            if (hasDifferent) {
              notesToUpdate = [];
            }
          }
        }

        if (notesToUpdate.length > 0) {
          const isIncomingProducerNote =
            !item.receipt_access_key && Boolean(item.note_access_key);

          for (const existingNote of existingNotes) {
            let sefazStatus = existingNote.status;

            if (
              item.receipt_access_key &&
              item.status !== '888' &&
              item.status !== '000'
            ) {
              sefazStatus = item.status || existingNote.status;
            } else if (
              existingNote.receipt_access_key &&
              existingNote.status !== '888' &&
              existingNote.status !== '000'
            ) {
              sefazStatus = existingNote.status;
            } else if (item.status !== '000' && item.status !== '888') {
              sefazStatus = item.status || existingNote.status;
            }

            await this.prismaService.notes_rural_suppliers.update({
              where: { id: existingNote.id },
              data: {
                note: isIncomingProducerNote
                  ? item.note || existingNote.note
                  : existingNote.note || item.note || null,

                note_access_key: isIncomingProducerNote
                  ? item.note_access_key || existingNote.note_access_key
                  : existingNote.note_access_key ||
                    item.note_access_key ||
                    null,

                note_date: isIncomingProducerNote
                  ? item.note_date
                    ? new Date(item.note_date)
                    : existingNote.note_date
                  : existingNote.note_date ||
                    (item.note_date ? new Date(item.note_date) : null),

                receipt: item.receipt || existingNote.receipt || null,
                receipt_access_key:
                  item.receipt_access_key ||
                  existingNote.receipt_access_key ||
                  null,
                receipt_date: item.receipt_date
                  ? new Date(item.receipt_date)
                  : existingNote.receipt_date,
                issuer_tax_id:
                  item.issuer_tax_id || existingNote.issuer_tax_id || null,

                status: sefazStatus,
              },
            });

            updatedCount++;
          }
          continue;
        }
      }

      await this.prismaService.notes_rural_suppliers.create({
        data: {
          supplier_tax_id: item.supplier_tax_id,
          supplier_name: supplierName,
          sector: sector,
          note: item.note || null,
          note_access_key: item.note_access_key || null,
          note_date: item.note_date ? new Date(item.note_date) : null,
          issuer_tax_id: item.issuer_tax_id || null,
          receipt: item.receipt || null,
          receipt_access_key: item.receipt_access_key || null,
          receipt_date: item.receipt_date ? new Date(item.receipt_date) : null,
          value: item.value || null,
          status: item.status || '000',
          is_duplicate: false,
        },
      });

      createdCount++;
    }

    await this.autoMergeOrphanNotes();
    await this.recalculateDuplicates();

    this.logger.log(
      `Processamento finalizado. Criadas: ${createdCount}, Atualizadas: ${updatedCount}`,
    );
    return {
      message: 'Importado com sucesso',
      created: createdCount,
      updated: updatedCount,
    };
  }

  async getNotes(startDate?: string, endDate?: string) {
    const where: any = {};

    if (startDate || endDate) {
      const dateFilter: any = {};

      if (startDate) dateFilter.gte = new Date(startDate);

      if (endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        dateFilter.lte = end;
      }

      where.OR = [{ receipt_date: dateFilter }, { note_date: dateFilter }];
    }

    return await this.prismaService.notes_rural_suppliers.findMany({
      where,
      orderBy: { created_at: 'desc' },
    });
  }

  async deleteNote(id: string) {
    this.logger.warn(`Solicitação para deletar a nota fiscal ID: ${id}`);

    const numericId = parseInt(id, 10);

    const note = await this.prismaService.notes_rural_suppliers.findUnique({
      where: { id: numericId },
    });

    if (!note) {
      throw new NotFoundException('Nota fiscal não encontrada no sistema.');
    }

    await this.prismaService.notes_rural_suppliers.delete({
      where: { id: numericId },
    });

    await this.recalculateDuplicates();
    return { message: 'Deletado com sucesso' };
  }

  private async autoMergeOrphanNotes() {
    const duplicates = await this.prismaService.notes_rural_suppliers.groupBy({
      by: ['note_access_key'],
      having: {
        note_access_key: {
          _count: {
            gt: 1,
          },
        },
      },
      where: {
        note_access_key: {
          not: null,
        },
      },
    });

    for (const dup of duplicates) {
      const key = dup.note_access_key as string;
      if (!key) continue;

      const notes = await this.prismaService.notes_rural_suppliers.findMany({
        where: { note_access_key: key },
        orderBy: { created_at: 'asc' },
      });

      if (notes.length <= 1) continue;

      const counterNote =
        notes.find(
          (n) =>
            n.receipt_access_key && n.status !== '888' && n.status !== '000',
        ) || notes[0];
      const baseNote = counterNote;

      const otherNotes = notes.filter(
        (n) => n.id !== baseNote.id && !n.receipt_access_key,
      );

      if (otherNotes.length === 0) continue;

      let mergedReceipt = baseNote.receipt;
      let mergedReceiptKey = baseNote.receipt_access_key;
      let mergedReceiptDate = baseNote.receipt_date;
      let mergedNoteNum = baseNote.note;
      let mergedNoteDate = baseNote.note_date;
      let mergedIssuer = baseNote.issuer_tax_id;
      let mergedValue = baseNote.value;

      for (const other of otherNotes) {
        if (!mergedReceipt) mergedReceipt = other.receipt;
        if (!mergedReceiptKey) mergedReceiptKey = other.receipt_access_key;
        if (!mergedReceiptDate) mergedReceiptDate = other.receipt_date;
        if (!mergedNoteNum) mergedNoteNum = other.note;
        if (!mergedNoteDate) mergedNoteDate = other.note_date;
        if (!mergedIssuer) mergedIssuer = other.issuer_tax_id;
        if (!mergedValue) mergedValue = other.value;
      }

      if (key.length === 44) {
        if (!mergedNoteNum)
          mergedNoteNum = parseInt(key.substring(25, 34), 10).toString();
      }

      const idsToDelete = otherNotes.map((n) => n.id);
      await this.prismaService.notes_rural_suppliers.deleteMany({
        where: { id: { in: idsToDelete } },
      });

      await this.prismaService.notes_rural_suppliers.update({
        where: { id: baseNote.id },
        data: {
          receipt: mergedReceipt,
          receipt_access_key: mergedReceiptKey,
          receipt_date: mergedReceiptDate,
          note: mergedNoteNum,
          note_date: mergedNoteDate,
          issuer_tax_id: mergedIssuer,
          value: mergedValue,
          status:
            counterNote.status !== '888' && counterNote.status !== '000'
              ? counterNote.status
              : baseNote.status,
        },
      });
    }

    const incompleteNotes =
      await this.prismaService.notes_rural_suppliers.findMany({
        where: {
          note_access_key: { not: null },
          OR: [{ note: null }, { note_date: null }],
        },
      });

    for (const n of incompleteNotes) {
      const key = n.note_access_key?.replace(/\D/g, '') || '';
      if (key.length === 44) {
        const noteNum =
          n.note || parseInt(key.substring(25, 34), 10).toString();
        const noteDate = n.note_date;
        await this.prismaService.notes_rural_suppliers.update({
          where: { id: n.id },
          data: { note: noteNum, note_date: noteDate },
        });
      }
    }
  }

  async updateNote(id: string, data: UpdateNoteRuralSuppliersDTO) {
    const numericId = parseInt(id, 10);

    const currentNote =
      await this.prismaService.notes_rural_suppliers.findUnique({
        where: { id: numericId },
      });

    if (!currentNote) {
      throw new NotFoundException('Nota não encontrada no sistema.');
    }

    let dataToUpdate: any = {
      ...data,
      ...(data.goods_received !== undefined && {
        goods_received: data.goods_received,
      }),
      ...(data.note_date && { note_date: new Date(data.note_date) }),
      ...(data.receipt_date && { receipt_date: new Date(data.receipt_date) }),
    };

    delete dataToUpdate.store_name;

    if (
      data.note_access_key &&
      data.note_access_key !== currentNote.note_access_key
    ) {
      const cleanKey = data.note_access_key.replace(/\D/g, '');
      dataToUpdate.note_access_key = cleanKey;

      if (cleanKey.length === 44) {
        if (!dataToUpdate.note && !currentNote.note) {
          dataToUpdate.note = parseInt(
            cleanKey.substring(25, 34),
            10,
          ).toString();
        }
      }

      const existingMatch =
        await this.prismaService.notes_rural_suppliers.findFirst({
          where: {
            note_access_key: cleanKey,
            id: { not: numericId },
          },
        });

      const canMerge =
        !currentNote.receipt_access_key || !existingMatch?.receipt_access_key;

      if (existingMatch && canMerge) {
        let sefazStatus = currentNote.status;

        if (dataToUpdate.status && dataToUpdate.status !== '888') {
          sefazStatus = dataToUpdate.status;
        } else if (
          currentNote.receipt_access_key &&
          currentNote.status !== '888' &&
          currentNote.status !== '000'
        ) {
          sefazStatus = currentNote.status;
        } else if (
          existingMatch.receipt_access_key &&
          existingMatch.status !== '888' &&
          existingMatch.status !== '000'
        ) {
          sefazStatus = existingMatch.status;
        }

        await this.prismaService.notes_rural_suppliers.delete({
          where: { id: numericId },
        });

        const mergedNote =
          await this.prismaService.notes_rural_suppliers.update({
            where: { id: existingMatch.id },
            data: {
              receipt:
                currentNote.receipt ||
                existingMatch.receipt ||
                dataToUpdate.receipt ||
                null,
              receipt_access_key:
                currentNote.receipt_access_key ||
                existingMatch.receipt_access_key ||
                dataToUpdate.receipt_access_key ||
                null,
              receipt_date:
                dataToUpdate.receipt_date ||
                currentNote.receipt_date ||
                existingMatch.receipt_date ||
                null,

              issuer_tax_id:
                currentNote.issuer_tax_id ||
                existingMatch.issuer_tax_id ||
                null,
              value: currentNote.value || existingMatch.value || null,

              note:
                existingMatch.note ||
                dataToUpdate.note ||
                currentNote.note ||
                null,
              note_date:
                existingMatch.note_date ||
                dataToUpdate.note_date ||
                currentNote.note_date ||
                null,

              status: sefazStatus,
            },
          });

        await this.recalculateDuplicates();
        return mergedNote;
      }
    }

    const updatedNote = await this.prismaService.notes_rural_suppliers.update({
      where: { id: numericId },
      data: dataToUpdate,
    });

    await this.recalculateDuplicates();
    return updatedNote;
  }

  async getDanfe(receiptAccessKey: string) {
    try {
      const response = await fetch(
        'https://consultadanfe.com/api/v1/consulta',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chave: receiptAccessKey,
          }),
          signal: AbortSignal.timeout(10000),
        },
      );

      if (response.ok) {
        const data = await response.json();

        if (data.status === 'ok' && data.pdf_base64) {
          return data.pdf_base64;
        }
      }
    } catch (error: any) {
      this.logger.error(
        `(consultadanfe.com) Falha na consulta para a chave ${receiptAccessKey}`,
        error.stack,
      );
    }

    try {
      const response = await fetch(
        `https://api.meudanfe.com.br/v2/fd/get/da/${receiptAccessKey}`,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(10000),
        },
      );

      if (response.ok) {
        const result = await response.json();

        if (result.data) {
          return result.data;
        }
      }
    } catch (error: any) {
      this.logger.error(
        `(meudanfe.com) Falha na consulta para a chave ${receiptAccessKey}`,
        error.stack,
      );
    }

    try {
      const response = await fetch(
        `https://api.meudanfe.com.br/v2/fd/add/${receiptAccessKey}`,
        {
          method: 'PUT',
          headers: {
            Accept: 'application/json',
            'api-key': process.env.MEU_DANFE_TOKEN || '',
          },
          signal: AbortSignal.timeout(10000),
        },
      );

      if (!response.ok) {
        console.warn(
          `(meudanfe.com) Falha ao adicionar a nota com chave ${receiptAccessKey}: ${response.status}`,
        );
      }
    } catch (error: any) {
      this.logger.error(
        `(meudanfe.com) Falha ao adicionar a nota com chave ${receiptAccessKey}`,
        error.stack,
      );
    }

    for (let attempt = 1; attempt <= 4; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 3000));

      try {
        const response = await fetch(
          `https://api.meudanfe.com.br/v2/fd/get/da/${receiptAccessKey}`,
          {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              'api-key': process.env.MEU_DANFE_TOKEN || '',
            },
            signal: AbortSignal.timeout(10000),
          },
        );

        if (response.ok) {
          const result = await response.json();
          if (result.data) {
            return result.data;
          }
        }
      } catch (error: any) {
        this.logger.warn(
          `(meudanfe.com) Tentativa de consultar ${attempt}/4 falhou: ${error.message}`,
        );
      }
    }

    this.logger.error(
      `Excedido limite de tentativas para resgatar DANFE da chave ${receiptAccessKey}`,
    );
    throw new BadRequestException(
      `Não foi possível resgatar o DANFE para a chave ${receiptAccessKey}. Verifique se o status do SEFAZ ou se há pendências no serviço.`,
    );
  }

  private async recalculateDuplicates() {
    const inactiveStatuses = ['135', '101', '151', '155'];

    const duplicates = await this.prismaService.notes_rural_suppliers.groupBy({
      by: ['note_access_key'],
      having: {
        note_access_key: {
          _count: {
            gt: 1,
          },
        },
      },
      where: {
        note_access_key: {
          not: null,
        },
        status: {
          notIn: inactiveStatuses,
        },
      },
    });

    const duplicateKeys = duplicates.map((d) => d.note_access_key as string);

    await this.prismaService.notes_rural_suppliers.updateMany({
      where: {
        status: { in: inactiveStatuses },
        is_duplicate: true,
      },
      data: { is_duplicate: false },
    });

    if (duplicateKeys.length > 0) {
      await this.prismaService.notes_rural_suppliers.updateMany({
        where: {
          note_access_key: { in: duplicateKeys },
          status: { notIn: inactiveStatuses },
          is_duplicate: false,
        },
        data: { is_duplicate: true },
      });

      await this.prismaService.notes_rural_suppliers.updateMany({
        where: {
          note_access_key: { notIn: duplicateKeys },
          status: { notIn: inactiveStatuses },
          is_duplicate: true,
        },
        data: { is_duplicate: false },
      });
    } else {
      await this.prismaService.notes_rural_suppliers.updateMany({
        where: { is_duplicate: true },
        data: { is_duplicate: false },
      });
    }
  }
}
