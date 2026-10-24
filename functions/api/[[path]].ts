import { apiError } from '../../server/http';

// Unknown /api/* paths answer 404 JSON instead of falling through to the SPA.
export const onRequest = () => apiError(404, 'not_found', 'Unknown API endpoint.');
