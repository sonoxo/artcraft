import { fireEvent, render, screen } from '@testing-library/react';
import { ImageIcon, VideoIcon } from 'lucide-react';
import { vi } from 'vitest';

import MenuIconSelector from './menu-icon-selector';

describe('MenuIconSelector', () => {
  
  it('should render successfully', () => {
    const onMenuChange = vi.fn();
    const { baseElement } = render(
      <MenuIconSelector
        menuItems={[
          { id: 'image', label: 'Image', icon: <ImageIcon /> },
          { id: 'video', label: 'Video', icon: <VideoIcon /> },
        ]}
        activeMenu="image"
        onMenuChange={onMenuChange}
      />,
    );
    expect(baseElement).toBeTruthy();
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]);
    expect(onMenuChange).toHaveBeenCalledWith('video');
  });
  
});
