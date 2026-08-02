# syntax=docker/dockerfile:1
FROM node:24

WORKDIR /app

# Setup pnpm as the package manager of this app.
# We leave npm in place though as it's very bound
# up in the node install.
RUN corepack enable && corepack prepare pnpm@10.21.0 --activate

RUN chown node:node /app
USER node
ENV USER=node

##################################################
########### TEMPORARY ROOT USER STARTS ###########
##################################################
# Temporarily becoming root to:
# 1. give node user passwordless sudo. This action
#    is not included in the base image because it
#    is not safe for production images.
# 2. copy project in with node user ownership
USER root
# - tcc: C compiler required for neovim LSP
# - ripgrep: Required for some neovim telescope functions
# - rpm: libicu package required for GCM (rpm is smallest apt available pacakage I could find which includes libicu)
RUN apt-get update && apt-get install -y --no-install-recommends \
      sudo git curl tcc ripgrep rpm tmux \
 && rm -rf /var/lib/apt/lists/*
RUN echo "node ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers.d/node && \
    chmod 0440 /etc/sudoers.d/node

COPY --chown=node:node . .

# Switch to node user for all development operations
USER node
##################################################
############ TEMPORARY ROOT USER ENDS ############ 
##################################################

# Allow git repo symlinks to be manifest as such
RUN git config core.symlinks true
# Reset .devcontainer.json from Windows prep
# change, and allow broken .claude symlinks to be
# returned to functionality.
RUN git reset --hard

# lazygit v0.63.1
RUN curl -Lo /tmp/lazygit.tar.gz \
      "https://github.com/jesseduffield/lazygit/releases/download/v0.63.1/lazygit_0.63.1_linux_x86_64.tar.gz" && \
    tar -xf /tmp/lazygit.tar.gz -C /tmp lazygit && \
    sudo install -D /tmp/lazygit /usr/local/bin/lazygit && \
    rm /tmp/lazygit.tar.gz /tmp/lazygit

# Neovim v0.11.2 (AppImage extracted because
# AppImages cannot mount inside containers without FUSE).
RUN curl -Lo /tmp/nvim.appimage \
      https://github.com/neovim/neovim/releases/download/v0.11.2/nvim-linux-x86_64.appimage && \
    chmod u+x /tmp/nvim.appimage && \
    cd /tmp && /tmp/nvim.appimage --appimage-extract && \
    rm /tmp/nvim.appimage && \
    sudo mv /tmp/squashfs-root /usr/bin/nvim-appimage-extract && \
    sudo ln -s /usr/bin/nvim-appimage-extract/AppRun /usr/bin/nvim
RUN git clone https://github.com/js-jslog/neovim-config.git /home/node/.config/nvim

# Embedded tmux configuration, symlinked into
# /etc/tmux.conf so it applies system-wide for any
# user inside the container. Required for the
# embedded Neovim workflow's keybindings.
RUN git clone https://github.com/js-jslog/tmux-config.git /home/node/.config/tmux-config && \
    sudo ln -s /home/node/.config/tmux-config/.tmux.xterm.conf /etc/tmux.conf

# GCM
RUN curl -Lo /tmp/gcm-linux_amd64.2.4.1.deb https://github.com/git-ecosystem/git-credential-manager/releases/download/v2.4.1/gcm-linux_amd64.2.4.1.deb
RUN sudo dpkg -i /tmp/gcm-linux_amd64.2.4.1.deb
RUN rm /tmp/gcm-linux_amd64.2.4.1.deb
RUN /usr/local/bin/git-credential-manager configure
RUN git config --global credential.credentialStore plaintext

# Claude
ENV PATH="/home/node/.local/bin:$PATH"
RUN echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
RUN curl -fsSL https://claude.ai/install.sh | bash

# git config
RUN git config --global user.name "js-jslog"
RUN git config --global user.email "josephsinfield@yahoo.com"
RUN git config --global merge.tool "nvimdiff"
RUN git config --global core.editor "nvim"

# Keep container running for devcontainer life.
# Required when using `overrideCommand: false` in
# the devcontainer.json which is essential for the
# DinD feature's entrypoint to start dockerd
CMD ["sleep", "infinity"]
