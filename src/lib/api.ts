import axios from 'axios';

// Create a dedicated axios instance for SSP relay requests
const api = axios.create();

// Store the current wkIdentity
let currentWkIdentity: string | null = null;

/**
 * Set the wkIdentity to be included in all requests.
 * Call this when the identity changes (e.g., after sync).
 */
export function setWkIdentity(wkIdentity: string | null) {
  currentWkIdentity = wkIdentity;
}

/**
 * Get the current wkIdentity.
 */
export function getWkIdentity(): string | null {
  return currentWkIdentity;
}

// Add request interceptor to include sspwkid header
api.interceptors.request.use((config) => {
  if (currentWkIdentity) {
    config.headers.sspwkid = currentWkIdentity;
  }
  return config;
});

export default api;
