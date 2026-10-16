import { render, screen } from '@testing-library/react';

import { Modal } from './modal';

describe('Modal', () => {
  
  it('should render successfully', async () => {
    const { baseElement } = render(
      <Modal
        isOpen={true}
        title="Upload image"
        accessibleDescription="Choose an image to add to the library."
        onClose={() => {}}
      >
        <p>Ready to upload</p>
      </Modal>,
    );
    expect(baseElement).toBeTruthy();
    expect(await screen.findByRole('dialog', { name: 'Upload image' })).toBeTruthy();
    expect(screen.getByText('Ready to upload')).toBeTruthy();
  });
  
});
