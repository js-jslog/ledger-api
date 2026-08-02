# Node-base devcontainer

This project is a template for js-jslog owned Node.js based projects which want to start their life
in a devcontainer.

## Extension

1. Fork the project
2. Update the image name in all the following files to the Docker Hub resource address you want to
   use:
   - .devcontainer/devcontainer.json: The `image` prop.
   - runcontainer.ps1: The `docker pull` command.
   - buildimage.sh: The `image` var.

3. Update the volume name in all the following files appropriately:
   - .devcontainer/devcontainer.json: The `workspaceMount` source name.
   - runcontainer.ps1: The `--filter volume=` & the `volume rm --force` commands.

4. Follow the Launch from Windows instructions with the additional step of manually building and
   pushing your very first image with these steps immediately after you have cloned the project:

```
docker build -t <user>/<image>:latest -f Dockerfile .
docker push <user>/<image>:latest
```

## Usage

### Launch from Windows

The project is intended for initiation on a Windows machine with Docker Desktop installed. Windows
is intended to only be used as a launchpad, and no changes to the project contents are expected. You
might want to change the appPort or the volume name, but this documentation doesn't cover those
scenarios, for simplicity.

There is a prerequisite to have installed the devcontainer CLI

```
git clone https://github.com/js-jslog/devcontainer-node-base.git
./runcontainer.ps1 start # replace with `destructive` to replace an existing container and volume.
```

### Publish a new image

New images are built and published from inside a container. By default the image will be tagged as
`latest` for convenience as the priority and this should be the normal workflow. The next section
explains why you might want to occasionally pass a tag id param to this script.

```
docker login
./buildimage.sh # optional tag id param (see below)
```

For simplicity, testing the new container is done back in Windows. Clone a new project and build a
test container on a different volume and with a different name. Edit all the locations in the
Extension section above for completeness. Start the container and do whatever tests are required.

### Broken :latest tag

If you overwrite the :latest tag with something which doesn't produce a working devcontainer then
you can recover from a "fallback" tagged image that you can make by using the optional parameter to
the buildimage.sh. It is not necessary to do this frequently, because even a very old tag will allow
you to pull the project inside the devcontainer and be back up to date to tweak whatever mistake you
made.

You will need to update certain resources in order to make use of a "fallback" tag. This path is not
seamlessly catered for, but should be simple enough if you again follow the file update list in the
Extension section above.
