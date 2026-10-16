import { act, cleanup, render, screen } from '@testing-library/react';
import { emit } from '@tauri-apps/api/event';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { afterEach, beforeEach } from 'vitest';
import { GenerationProvider } from '@storyteller/common';

import FrontendProviderBillingModal from './provider-billing-modal';

beforeEach(() => {
  mockIPC((command) => {
    throw new Error(`Unexpected native command in billing modal test: ${command}`);
  }, { shouldMockEvents: true });
});

afterEach(async () => {
  cleanup();
  // Let the hook's asynchronous unlisten finish before clearing native mocks.
  await Promise.resolve();
  clearMocks();
});

describe('FrontendProviderBillingModal', () => {
  
  it('should render successfully', async () => {
    const { baseElement } = render(<FrontendProviderBillingModal />);
    expect(baseElement).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();

    await act(async () => {
      await emit('show_provider_billing_modal_event', {
        data: { provider: GenerationProvider.Fal },
      });
    });

    expect(await screen.findByRole('heading', { name: 'Set up Fal' })).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
  
});
