/** An error whose message is safe and useful to show to the user (not a 500). */
export class ClientError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}
