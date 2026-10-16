import { render, screen } from '@testing-library/react';

import { ButtonDropdown } from './button-dropdown';

describe('ButtonDropdown', () => {
  
  it('should render successfully', () => {
    const { baseElement } = render(
      <ButtonDropdown label="Export" options={[{ label: 'Download image' }]} />,
    );
    expect(baseElement).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export' })).toBeTruthy();
  });
  
});
