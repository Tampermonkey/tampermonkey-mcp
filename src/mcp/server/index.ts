import { stdio } from './server';
import { logger as console } from '../../shared/logger';

await stdio()
.catch((err) => {
    console.error(err);
    process.exit(1);
});