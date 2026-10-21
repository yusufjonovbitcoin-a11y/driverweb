import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import '../../src/workspace-design.css';
import { setAppLocale } from '../../src/i18n/index.js';
import FleetDriverPicker from '../../src/components/FleetDriverPicker.jsx';

await setAppLocale('en', { persist: false });
const params = new URLSearchParams(location.search);
const drivers = params.has('empty') ? [] : Array.from({ length: 60 }, (_, index) => ({
  id: `driver-${index}`, name: index === 0 ? 'Amin Test' : `Driver ${index}`, truck: `T-${100 + index}`, driverNumber: `N-${index}`, isOnline: index % 2 === 0,
}));

export function Fixture() {
  const [selected, setSelected] = useState('driver-0');
  return <main className="workspace-shell" style={{ minHeight: '100dvh' }}>
    <button type="button" style={{ position: 'absolute', top: 16, left: 16 }}>Outside</button>
    <output aria-label="Selected driver" style={{ position: 'absolute', top: 60, left: 16 }}>{selected}</output>
    <section style={{ position: 'absolute', bottom: 20, left: 20, width: 'min(230px,calc(100vw - 40px))' }}>
      <FleetDriverPicker drivers={drivers} selectedDriver={drivers.find(driver => driver.id === selected)} onSelect={setSelected} />
      <button type="button">After picker</button>
    </section>
  </main>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
