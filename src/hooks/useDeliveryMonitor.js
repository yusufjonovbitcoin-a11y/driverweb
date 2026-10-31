import { useEffect, useMemo, useState } from 'react';
import { useArrivalEstimates } from './useArrivalEstimates.js';
import { arrivalDemo } from '../components/arrivalDemo.js';
import { deliveryMonitorJobs, deliveryMonitorState } from '../components/deliveryMonitorModel.js';

const EMPTY_JOBS = [];

// The button and the monitor use the same estimates, even while the roster is
// displayed. Search and status filters must not hide an operational warning.
export function useDeliveryMonitor(drivers, loads, demo) {
  const [now, setNow] = useState(Date.now);
  const [demoStart] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const jobs = useMemo(() => deliveryMonitorJobs(drivers, loads, now), [drivers, loads, now]);
  const estimates = useArrivalEstimates(demo ? EMPTY_JOBS : jobs, now);
  const demoRows = useMemo(() => arrivalDemo(demoStart), [demoStart]);
  const rows = demo ? demoRows : jobs.map(job => ({ job, state: deliveryMonitorState(job, estimates[job.id], now) }));
  return { now, rows };
}
