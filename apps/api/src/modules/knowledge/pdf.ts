/**
 * PDF text extraction.
 *
 * `unpdf` is used because it works on raw bytes (no temp file) and does not
 * require the optional `canvas` native module for text extraction.
 */
import { extractText, getDocumentProxy } from 'unpdf';
import { AppError, errorMessage } from '../../lib/errors.js';

export interface PdfExtraction {
  text: string;
  pageCount: number;
}

export async function extractPdfText(data: Buffer): Promise<PdfExtraction> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(data));
    const { text, totalPages } = await extractText(pdf, { mergePages: true });
    return {
      text: normalize(text),
      pageCount: totalPages,
    };
  } catch (error) {
    throw new AppError(`Could not read the PDF: ${errorMessage(error)}`, {
      kind: 'validation',
      userMessage: 'The PDF could not be read. If it is a scan, export it as text or Markdown and import again.',
      cause: error,
    });
  }
}

function normalize(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
