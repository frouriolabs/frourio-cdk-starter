import { config } from 'dotenv';
import { z } from 'zod';

config();

const FILE_ASSETS_BUCKET_NAME = z.string().parse(process.env.FILE_ASSETS_BUCKET_NAME);

export { FILE_ASSETS_BUCKET_NAME };
