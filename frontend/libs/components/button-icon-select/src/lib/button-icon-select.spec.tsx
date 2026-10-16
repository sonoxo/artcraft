import { fireEvent, render, screen } from '@testing-library/react';
import { ImageIcon, VideoIcon } from 'lucide-react';
import { vi } from 'vitest';

import { ButtonIconSelect } from './button-icon-select';

describe('ButtonIconSelect', () => {
  
  it('should render successfully', () => {
    const onOptionChange = vi.fn();
    const { baseElement } = render(
      <ButtonIconSelect
        options={[
          { value: 'image', icon: ImageIcon, text: 'Image' },
          { value: 'video', icon: VideoIcon, text: 'Video' },
        ]}
        selectedOption="image"
        onOptionChange={onOptionChange}
      />,
    );
    expect(baseElement).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Video' }));
    expect(onOptionChange).toHaveBeenCalledWith('video');
  });
  
});
