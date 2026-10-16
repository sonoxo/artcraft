import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import TabSelector from './tab-selector';

describe('TabSelector', () => {
  
  it('should render successfully', () => {
    const onTabChange = vi.fn();
    const { baseElement } = render(
      <TabSelector
        tabs={[{ id: 'image', label: 'Image' }, { id: 'video', label: 'Video' }]}
        activeTab="image"
        onTabChange={onTabChange}
      />,
    );
    expect(baseElement).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Image' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: 'Video' }));
    expect(onTabChange).toHaveBeenCalledWith('video');
  });
  
});
