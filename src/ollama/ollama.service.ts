import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class OllamaService {
  private readonly logger = new Logger(OllamaService.name);
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.getOrThrow<string>('OLLAMA_URL');
    this.model = this.config.get<string>('OLLAMA_EMBED_MODEL', 'nomic-embed-text');
  }

  async embed(text: string): Promise<number[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, input: text }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Ollama respondió ${response.status}: ${error}`);
      }

      const data = await response.json();

      // /api/embed devuelve { embeddings: number[][] }
      const vector: number[] = data.embeddings?.[0];

      if (!vector || vector.length === 0) {
        throw new Error('Ollama devolvió un embedding vacío');
      }

      this.logger.debug(`Embedding generado (dim=${vector.length}) modelo="${this.model}"`);
      return vector;

    } catch (err: any) {
      this.logger.error(`[OllamaService.embed] ${err.message}`);
      throw new InternalServerErrorException({
        message: 'Error al generar embedding con Ollama.',
        details: err.message,
      });
    }
  }
}