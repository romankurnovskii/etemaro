import { render, screen } from '@testing-library/react';
import Pill from './Pill';

describe('Pill component', () => {
  it('renders children correctly', () => {
    render(<Pill>Test Pill</Pill>);
    expect(screen.getByText('Test Pill')).toBeInTheDocument();
  });

  it('applies additional class names', () => {
    const { container } = render(
      <Pill className="custom-class">Styled Pill</Pill>
    );
    const pillElement = container.firstChild as HTMLElement;
    expect(pillElement).toHaveClass('custom-class');
  });
});
