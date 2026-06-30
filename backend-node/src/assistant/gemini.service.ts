import { HttpException, Injectable, Logger } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';

/**
 * Envoltura fina sobre el SDK oficial de Gemini (@google/genai).
 * Fuerza salida JSON validada por un responseSchema y centraliza el manejo de
 * errores/timeout. La API key se lee de GEMINI_API_KEY (gratis en
 * https://aistudio.google.com/apikey). Modelo configurable con GEMINI_MODEL.
 */
@Injectable()
export class GeminiService {
  private readonly logger = new Logger('GeminiService');
  private client: GoogleGenAI | null = null;

  get model(): string {
    return process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  }

  isConfigured(): boolean {
    return !!process.env.GEMINI_API_KEY?.trim();
  }

  private getClient(): GoogleGenAI {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      throw new HttpException(
        {
          detail:
            'Falta GEMINI_API_KEY en el backend. Consíguela gratis en ' +
            'https://aistudio.google.com/apikey y ponla en backend-node/.env',
        },
        400,
      );
    }
    if (!this.client) this.client = new GoogleGenAI({ apiKey });
    return this.client;
  }

  /** Llama a Gemini forzando salida JSON validada por `schema`. */
  async generateJson<T = any>(opts: {
    system: string;
    user: string;
    schema: any;
    temperature?: number;
    timeoutMs?: number;
  }): Promise<T> {
    const ai = this.getClient();
    const timeoutMs = opts.timeoutMs ?? 60000;

    const call = ai.models.generateContent({
      model: this.model,
      contents: opts.user,
      config: {
        systemInstruction: opts.system,
        responseMimeType: 'application/json',
        responseSchema: opts.schema,
        temperature: opts.temperature ?? 0.6,
      },
    });

    let res: any;
    try {
      res = await this.withTimeout(call, timeoutMs);
    } catch (e: any) {
      const msg = e?.message || String(e);
      this.logger.error(`Gemini error: ${msg}`);
      if (/timed out/i.test(msg)) {
        throw new HttpException({ detail: 'Gemini tardó demasiado en responder.' }, 504);
      }
      if (/api[_ ]?key|permission|invalid|quota|exhausted/i.test(msg)) {
        throw new HttpException({ detail: `Gemini rechazó la petición: ${msg}` }, 502);
      }
      throw new HttpException({ detail: `Error llamando a Gemini: ${msg}` }, 502);
    }

    const text = (res?.text ?? '').trim();
    if (!text) throw new HttpException({ detail: 'Gemini devolvió una respuesta vacía.' }, 502);

    try {
      return JSON.parse(text) as T;
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          return JSON.parse(m[0]) as T;
        } catch {
          /* cae al error de abajo */
        }
      }
      this.logger.error(`No se pudo parsear el JSON de Gemini: ${text.slice(0, 200)}`);
      throw new HttpException({ detail: 'No se pudo interpretar la respuesta de Gemini.' }, 502);
    }
  }

  private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`Gemini timed out after ${ms}ms`)), ms);
      p.then(
        (v) => {
          clearTimeout(t);
          resolve(v);
        },
        (e) => {
          clearTimeout(t);
          reject(e);
        },
      );
    });
  }
}
