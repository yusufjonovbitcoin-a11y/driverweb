import { lazy, Suspense, useEffect, useState } from 'react';
import { MapPin, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { fetchImportRoute } from '../services/importRoute';

const TrackingMap = lazy(() => import('./TrackingMap'));
const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN?.trim();

export default function ImportRouteMap({ pickup, delivery, enabled = true, driverId, driverName, livePosition, roadRoute }) {
  const { t } = useTranslation();
  const key = JSON.stringify([pickup, delivery]);
  const [result, setResult] = useState(null);
  const useRoadRoute = roadRoute !== undefined;
  const readyToFetch = Boolean(enabled && token && pickup && delivery && !useRoadRoute);
  const current = useRoadRoute ? roadRoute?.data : result?.key === key ? result : null;
  useEffect(() => {
    if (!readyToFetch) return undefined;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    let disposed = false;
    fetchImportRoute(pickup, delivery, token, controller.signal)
      .then(route => { if (!disposed) setResult({ key, ...route }); })
      .catch(() => { if (!disposed) setResult({ key, error: true }); })
      .finally(() => clearTimeout(timeout));
    return () => { disposed = true; clearTimeout(timeout); controller.abort(); };
  }, [pickup, delivery, key, readyToFetch]);
  const loading = useRoadRoute ? !roadRoute : readyToFetch && !current;
  const placeholder = <div className="import-map-placeholder">
    {loading ? <LoaderCircle className="h-7 w-7 animate-spin" /> : <MapPin className="h-8 w-8" />}
    <p>{t(loading ? 'loadImport.routeLoading' : 'loadImport.routeUnavailable')}</p>
  </div>;
  return <section className="import-map" aria-label={t('loadImport.route')}>
    <div className="import-map-canvas">
      {current?.points && enabled && token ? <Suspense fallback={placeholder}>
        <TrackingMap points={current.points} livePosition={livePosition}
          deadheadPoints={current.targets?.find(item => item.driverId === driverId)?.points}
          routeKey={`${key}:${driverId || ''}:${Boolean(livePosition)}`}
          lineColor="#008573" liveMarkerIcon="truck"
          pickupLabel={t('inbox.pickup')} deliveryLabel={t('inbox.delivery')}
          liveLabel={driverName || t('loadImport.currentLocation')}
          title={t('loadImport.route')} />
      </Suspense> : placeholder}
    </div>
  </section>;
}
