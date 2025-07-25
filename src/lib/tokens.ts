import axios from 'axios';
import { sspConfig } from '@storage/ssp';
import { tokenDataSSPRelay } from '../../src/types';

export async function getTokenMetadata(
  contractAddress: string,
  network: string,
): Promise<tokenDataSSPRelay | null> {
  try {
    const url = `https://${sspConfig().relay}/v1/tokeninfo/${network}/${contractAddress}`;
    const response = await axios.get<tokenDataSSPRelay>(url);
    return response.data;
  } catch (error) {
    console.error(error);
    return null;
  }
}
