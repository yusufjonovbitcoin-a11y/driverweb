import React from 'react';
import DriverRosterList from './DriverRosterList';

const loadDriverDetail = () => import('./DriverRoster');
const DriverRoster = React.lazy(loadDriverDetail);

export default function DriversPage(props) {
  const selectedDriverExists = props.drivers.some(driver => driver.id === props.selectedDriverId);
  if (selectedDriverExists) return <React.Suspense fallback={<div className="min-h-48" />}><DriverRoster {...props} /></React.Suspense>;

  return <DriverRosterList
    drivers={props.drivers}
    loads={props.loads}
    onOpenDriver={props.onSelectDriver}
    onPrefetchDriver={loadDriverDetail}
    onAssignLoad={props.onAssignLoad}
    onOpenChat={props.onOpenChat}
    unreadChatsByDriver={props.unreadChatsByDriver}
  />;
}
