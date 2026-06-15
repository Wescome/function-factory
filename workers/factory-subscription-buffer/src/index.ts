/**
 * factory-subscription-buffer — CF Worker host
 *
 * Hosts the SubscriptionEventBufferDO Durable Object.
 * Referenced as script_name: "factory-subscription-buffer" by factory-gateway
 * and factory-graphql workers.
 *
 * The DO itself handles all request routing — this Worker's fetch handler is
 * only invoked for direct top-level requests (not DO requests).
 */

import { SubscriptionEventBufferDO } from '@factory/subscription-buffer'

export { SubscriptionEventBufferDO }

export default {
  fetch(): Response {
    return new Response('ok')
  },
}
