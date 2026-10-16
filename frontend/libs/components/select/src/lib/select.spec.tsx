import { render, screen } from '@testing-library/react';

import Select from './select';

describe('Select', () => {
  
  it('should render successfully', () => {
    const { baseElement } = render(
      <Select
        options={[{ label: 'PNG', value: 'png' }, { label: 'JPEG', value: 'jpeg' }]}
        value="png"
        onChange={() => {}}
      />,
    );
    expect(baseElement).toBeTruthy();
    expect(screen.getByRole('button', { name: 'PNG' })).toBeTruthy();
  });
  
});
