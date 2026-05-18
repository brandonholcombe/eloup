'use client';

import { useState } from 'react';
import { LapChart, type LapChartDriver } from '@/components/LapChart';

export function RaceChartSection({ drivers }: { drivers: LapChartDriver[] }) {
  const [visible, setVisible] = useState<Set<string>>(
    () => new Set(drivers.map((d) => d.driverId)),
  );

  return (
    <LapChart
      drivers={drivers}
      visibleDriverIds={visible}
      onToggle={(id) =>
        setVisible((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          // Never let the operator hide every driver. Refusing the
          // last hide is friendlier than re-showing all drivers — a
          // mid-comparison stray tap shouldn't blow away the current
          // visible set.
          if (next.size === 0) return prev;
          return next;
        })
      }
      onIsolate={(id) => setVisible(new Set([id]))}
    />
  );
}
